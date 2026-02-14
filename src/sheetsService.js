// ─── Google Sheets Export Service ─────────────────────────

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ─── GIS Script Loader ────────────────────────────────────

let gisLoaded = false;

export function loadGisScript() {
    if (gisLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
        if (window.google?.accounts?.oauth2) {
            gisLoaded = true;
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => { gisLoaded = true; resolve(); };
        script.onerror = () => reject(new Error('Falha ao carregar Google Identity Services'));
        document.head.appendChild(script);
    });
}

// ─── OAuth Token ──────────────────────────────────────────

export function getAccessToken(clientId) {
    return new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: (response) => {
                if (response.error) {
                    reject(new Error(response.error_description || response.error));
                } else {
                    resolve(response.access_token);
                }
            },
            error_callback: (err) => {
                reject(new Error(err?.message || 'Autenticação Google cancelada'));
            },
        });
        client.requestAccessToken();
    });
}

// ─── Spreadsheet ID Extraction ────────────────────────────

export function extractSpreadsheetId(url) {
    if (!url) return null;
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

// ─── Column Mapping ───────────────────────────────────────

export const HEADER_ROW = [
    'CD_PRODUTOR_IE',
    'DT_NF',
    'NR_NF',
    'CD_SERIE',
    'CD_CHAVE',
    'FL_RESPONSABILIDADE',
    'QT_LITROS',
    'VR_TOTAL',
    'VR_MERCADORIA',
    'VR_FRETE',
    'VR_BC',
    'VR_DEDUCOES',
    'VR_INCENTIVO',
    'VR-ICMS',
];

function round2(n) {
    return Math.round(n * 100) / 100;
}

function fmtDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    } catch {
        return dateStr;
    }
}

export function mapNotaToRow(nota, detail) {
    const d = detail || {};
    const n = nota || {};

    // Try to get item-level data
    const items = d.itens || n.itens || [];
    const firstItem = items[0] || {};
    const quantidade = firstItem.quantidade || 0;
    const valorUnitario = firstItem.valor || firstItem.valorUnitario || firstItem.preco || 0;

    // Calculate totalProdutos from items, or derive from valorNota
    let totalProdutos = 0;
    if (items.length > 0) {
        // Sum all items: qty * unit price
        totalProdutos = items.reduce((sum, item) => {
            const qty = item.quantidade || 0;
            const val = item.valor || item.valorUnitario || item.preco || 0;
            return sum + round2(qty * val);
        }, 0);
    }
    // Fallback: try direct fields
    if (!totalProdutos) {
        totalProdutos = d.totalProdutos ?? n.totalProdutos ?? 0;
    }
    // Last resort: derive from valorNota (valorNota = totalProdutos * 1.025)
    const valorNota = d.valorNota ?? n.valorNota ?? 0;
    if (!totalProdutos && valorNota) {
        totalProdutos = round2(valorNota / 1.025);
    }

    const incentivo = round2(totalProdutos * 0.025);
    const icms = round2(totalProdutos * 0.12);

    // Debug: log the detail structure to help diagnose field names
    if (detail) {
        console.log('[SheetsExport] NFe detail keys:', Object.keys(detail));
        console.log('[SheetsExport] First item keys:', Object.keys(firstItem));
        console.log('[SheetsExport] totalProdutos:', totalProdutos, 'valorNota:', valorNota);
    }

    return [
        d.contato?.ie || d.contato?.inscricaoEstadual || n.contato?.ie || '',  // CD_PRODUTOR_IE
        fmtDate(d.dataEmissao || n.dataEmissao),                               // DT_NF
        d.numero || n.numero || '',                                             // NR_NF
        d.serie || n.serie || '',                                               // CD_SERIE
        d.chaveAcesso || '',                                                    // CD_CHAVE
        'L',                                                                    // FL_RESPONSABILIDADE
        quantidade,                                                             // QT_LITROS
        valorNota,                                                              // VR_TOTAL
        totalProdutos,                                                          // VR_MERCADORIA
        0,                                                                      // VR_FRETE
        totalProdutos,                                                          // VR_BC
        0,                                                                      // VR_DEDUCOES
        incentivo,                                                              // VR_INCENTIVO
        icms,                                                                   // VR-ICMS
    ];
}

// ─── Append to Google Sheets ──────────────────────────────

export async function appendRows(accessToken, spreadsheetId, rows, sheetName = 'Sheet1') {
    const range = `${sheetName}!A1`;
    const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?` +
        new URLSearchParams({
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
        });

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            values: rows,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || `Erro ${res.status}`;
        throw new Error(`Erro Google Sheets: ${msg}`);
    }

    return res.json();
}
