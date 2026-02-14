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

export function mapNotaToRow(nota, detail, contatoIe = '') {
    const d = detail || {};
    const n = nota || {};

    // Bling API: itens[].quantidade, itens[].valor (unit price), itens[].valorTotal (readOnly total)
    const items = d.itens || n.itens || [];
    const firstItem = items[0] || {};
    const quantidade = firstItem.quantidade || 0;

    // Calculate totalProdutos by summing item.valorTotal (or qty * unit price as fallback)
    let totalProdutos = items.reduce((sum, item) => {
        // Prefer valorTotal (computed by Bling), fallback to valor * quantidade
        const itemTotal = item.valorTotal || ((item.valor || 0) * (item.quantidade || 0));
        return sum + itemTotal;
    }, 0);
    totalProdutos = round2(totalProdutos);

    // Bling API: valorNota at the NFe level
    const valorNota = d.valorNota ?? n.valorNota ?? 0;

    // Last resort: derive from valorNota if items gave nothing
    if (!totalProdutos && valorNota) {
        totalProdutos = round2(valorNota / 1.025);
    }

    const incentivo = round2(totalProdutos * 0.025);
    const icms = round2(totalProdutos * 0.12);

    return [
        contatoIe || d.contato?.ie || n.contato?.ie || '',                     // CD_PRODUTOR_IE
        fmtDate(d.dataEmissao || n.dataEmissao),                               // DT_NF
        d.numero || n.numero || '',                                             // NR_NF
        d.serie ?? n.serie ?? '',                                               // CD_SERIE
        d.chaveAcesso || n.chaveAcesso || '',                                    // CD_CHAVE
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

    const result = await res.json();

    // Force white background on the appended range
    try {
        const updatedRange = result?.updates?.updatedRange;
        if (updatedRange) {
            await setWhiteBackground(accessToken, spreadsheetId, sheetName, updatedRange);
        }
    } catch {
        // Formatting is best-effort, don't fail the export
    }

    return result;
}

async function getSheetId(accessToken, spreadsheetId, sheetName) {
    const url = `${SHEETS_API}/${spreadsheetId}?fields=sheets.properties`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const sheet = data?.sheets?.find(s => s.properties?.title === sheetName);
    return sheet?.properties?.sheetId ?? 0;
}

function parseRange(rangeStr) {
    // e.g. "Sheet1!A2:N15" -> { startRow: 1, endRow: 15, startCol: 0, endCol: 14 }
    const cellPart = rangeStr.includes('!') ? rangeStr.split('!')[1] : rangeStr;
    const [startCell, endCell] = cellPart.split(':');
    const colToNum = (c) => {
        let n = 0;
        for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64;
        return n - 1;
    };
    const parse = (cell) => {
        const m = cell.match(/^([A-Z]+)(\d+)$/);
        return m ? { col: colToNum(m[1]), row: parseInt(m[2], 10) - 1 } : { col: 0, row: 0 };
    };
    const s = parse(startCell);
    const e = endCell ? parse(endCell) : s;
    return { startRow: s.row, startCol: s.col, endRow: e.row + 1, endCol: e.col + 1 };
}

async function setWhiteBackground(accessToken, spreadsheetId, sheetName, updatedRange) {
    const sheetId = await getSheetId(accessToken, spreadsheetId, sheetName);
    const { startRow, startCol, endRow, endCol } = parseRange(updatedRange);

    const url = `${SHEETS_API}/${spreadsheetId}:batchUpdate`;
    await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            requests: [{
                repeatCell: {
                    range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 1, green: 1, blue: 1 },
                        },
                    },
                    fields: 'userEnteredFormat.backgroundColor',
                },
            }],
        }),
    });
}
