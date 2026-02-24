import { useState, useCallback, useRef } from 'react';
import { Sheet, Loader2, CheckCircle2, Settings, Link2, Download } from 'lucide-react';
import { listarNfe, obterNfe, obterContato } from '../nfeService.js';
import {
    loadGisScript,
    getAccessToken,
    extractSpreadsheetId,
    mapNotaToRow,
    appendRows,
    HEADER_ROW,
} from '../sheetsService.js';

function getStored(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
}

function setStored(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

export default function SheetsExport({ token, showToast }) {
    const [sheetsUrl, setSheetsUrl] = useState(() => getStored('sheets_url', ''));
    const [googleClientId, setGoogleClientId] = useState(() => getStored('google_client_id', ''));
    const [showConfig, setShowConfig] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(null);
    const [previewRows, setPreviewRows] = useState(null);
    const [includeHeader, setIncludeHeader] = useState(false);
    const [sheetName, setSheetName] = useState(() => getStored('sheets_tab_name', ''));

    // Default to current month
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    const [dataInicial, setDataInicial] = useState(firstDay);
    const [dataFinal, setDataFinal] = useState(lastDay);

    const abortRef = useRef(false);

    const spreadsheetId = extractSpreadsheetId(sheetsUrl);
    const isReady = spreadsheetId && googleClientId;

    const handleUrlChange = useCallback((e) => {
        const url = e.target.value;
        setSheetsUrl(url);
        setStored('sheets_url', url);
        setPreviewRows(null);
    }, []);

    const handleClientIdChange = useCallback((e) => {
        const id = e.target.value;
        setGoogleClientId(id);
        setStored('google_client_id', id);
    }, []);

    // Fetch all notas and their details
    async function fetchAllNotasWithDetails() {
        setProgress({ step: 'Carregando notas...', current: 0, total: 0 });

        const allNotas = [];
        let pagina = 1;
        let hasMore = true;

        while (hasMore) {
            const res = await listarNfe(token, { pagina, limite: 100, dataInicial, dataFinal });
            const data = res?.data || [];
            allNotas.push(...data);
            hasMore = data.length >= 100;
            pagina++;
        }

        if (allNotas.length === 0) {
            throw new Error('Nenhuma nota fiscal encontrada.');
        }

        setProgress({ step: 'Carregando detalhes...', current: 0, total: allNotas.length });

        const rows = [];
        const contatoCache = {}; // Cache IE by contact id
        for (let i = 0; i < allNotas.length; i++) {
            if (abortRef.current) throw new Error('Exportação cancelada.');

            const nota = allNotas[i];
            let detail = null;
            try {
                const res = await obterNfe(token, nota.id);
                detail = res?.data;
            } catch {
                // If we can't get detail, use nota data only
            }

            // Fetch contact IE if not cached
            const contatoId = detail?.contato?.id || nota?.contato?.id;
            let contatoIe = '';
            if (contatoId) {
                if (contatoCache[contatoId] !== undefined) {
                    contatoIe = contatoCache[contatoId];
                } else {
                    try {
                        const cRes = await obterContato(token, contatoId);
                        contatoIe = cRes?.data?.ie || '';
                    } catch { /* ignore */ }
                    contatoCache[contatoId] = contatoIe;
                }
            }

            rows.push(mapNotaToRow(nota, detail, contatoIe));
            setProgress({ step: 'Carregando detalhes...', current: i + 1, total: allNotas.length });
        }

        return rows;
    }

    async function handlePreview() {
        setExporting(true);
        abortRef.current = false;
        try {
            const rows = await fetchAllNotasWithDetails();
            setPreviewRows(rows);
            setProgress(null);
            showToast(`${rows.length} notas carregadas para preview.`);
        } catch (err) {
            showToast(err.message || 'Erro ao carregar notas.', true);
            setProgress(null);
        } finally {
            setExporting(false);
        }
    }

    async function handleExport() {
        if (!isReady) {
            showToast('Configure a URL da planilha e o Google Client ID.', true);
            return;
        }

        setExporting(true);
        abortRef.current = false;

        try {
            // Step 1: Load GIS
            setProgress({ step: 'Carregando Google Auth...', current: 0, total: 0 });
            await loadGisScript();

            // Step 2: Get access token
            setProgress({ step: 'Autenticando com Google...', current: 0, total: 0 });
            const accessToken = await getAccessToken(googleClientId);

            // Step 3: Fetch data (or use preview)
            let rows = previewRows;
            if (!rows) {
                rows = await fetchAllNotasWithDetails();
            }

            // Step 4: Append to sheet
            setProgress({ step: 'Enviando para Google Sheets...', current: 0, total: rows.length });

            const allRows = includeHeader ? [HEADER_ROW, ...rows] : rows;
            await appendRows(accessToken, spreadsheetId, allRows, sheetName || 'Sheet1');

            setProgress(null);
            showToast(`${rows.length} notas exportadas com sucesso para Google Sheets!`);
        } catch (err) {
            showToast(err.message || 'Erro na exportação.', true);
            setProgress(null);
        } finally {
            setExporting(false);
        }
    }

    function handleCancel() {
        abortRef.current = true;
    }

    return (
        <div className="export-container">
            <div className="card glass">
                <h2 className="card-title">
                    <Sheet size={20} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
                    Exportar para Google Sheets
                </h2>
                <p className="card-desc">
                    Exporte os dados das notas fiscais diretamente para uma planilha do Google Sheets.
                </p>

                <div className="export-form">
                    {/* Spreadsheet URL */}
                    <div className="field">
                        <label htmlFor="sheets-url">
                            <Link2 size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />
                            Link da Planilha Google Sheets
                        </label>
                        <input
                            id="sheets-url"
                            type="url"
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            value={sheetsUrl}
                            onChange={handleUrlChange}
                        />
                        {sheetsUrl && (
                            <small className={`url-status ${spreadsheetId ? 'valid' : 'invalid'}`}>
                                {spreadsheetId
                                    ? <><CheckCircle2 size={12} /> ID detectado: <code>{spreadsheetId.slice(0, 20)}...</code></>
                                    : 'URL inválida — cole o link completo da planilha'}
                            </small>
                        )}
                    </div>

                    {/* Sheet Tab Name */}
                    <div className="field">
                        <label htmlFor="sheet-name">Nome da Aba (página da planilha)</label>
                        <input
                            id="sheet-name"
                            type="text"
                            placeholder="Sheet1"
                            value={sheetName}
                            onChange={(e) => { setSheetName(e.target.value); setStored('sheets_tab_name', e.target.value); }}
                        />
                        <small className="url-status valid" style={{ color: 'var(--text-dim)' }}>
                            Deixe em branco para usar "Sheet1".
                        </small>
                    </div>

                    {/* Date Range */}
                    <div className="form-row dates-row" style={{ display: 'flex', gap: '1rem', marginTop: '1rem', marginBottom: '1rem' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Data Inicial</label>
                            <input
                                type="date"
                                value={dataInicial}
                                onChange={(e) => setDataInicial(e.target.value)}
                                style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Data Final</label>
                            <input
                                type="date"
                                value={dataFinal}
                                onChange={(e) => setDataFinal(e.target.value)}
                                style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                            />
                        </div>
                    </div>

                    {/* Header Checkbox */}
                    <div className="checkbox-group" style={{ marginBottom: '1.5rem' }}>
                        <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={includeHeader}
                                onChange={(e) => setIncludeHeader(e.target.checked)}
                            />
                            Incluir linha de cabeçalho
                        </label>
                    </div>

                    {/* Google Config (collapsible) */}
                    <div className="config-section">
                        <button className="config-toggle" onClick={() => setShowConfig(!showConfig)}>
                            <Settings size={14} />
                            Configurar Google Cloud
                            {googleClientId && <span className="config-status">✓ Configurado</span>}
                            <span style={{ marginLeft: 'auto' }}>{showConfig ? '▲' : '▼'}</span>
                        </button>

                        {showConfig && (
                            <div className="config-form">
                                <p className="config-hint">
                                    Crie um OAuth Client ID no Google Cloud Console com a Sheets API habilitada.
                                    Adicione <code>{window.location.origin}</code> como origem JavaScript autorizada.
                                </p>
                                <div className="field">
                                    <label htmlFor="google-client-id">OAuth Client ID</label>
                                    <input
                                        id="google-client-id"
                                        type="text"
                                        placeholder="xxxx.apps.googleusercontent.com"
                                        value={googleClientId}
                                        onChange={handleClientIdChange}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="export-actions">
                        <button
                            className="btn btn-secondary"
                            onClick={handlePreview}
                            disabled={exporting}
                        >
                            {exporting && !progress?.step?.includes('Google')
                                ? <Loader2 size={14} className="spin" />
                                : <Download size={14} />}
                            Carregar Preview
                        </button>

                        <button
                            className="btn btn-export"
                            onClick={handleExport}
                            disabled={!isReady || exporting}
                        >
                            {exporting && progress?.step?.includes('Google')
                                ? <Loader2 size={14} className="spin" />
                                : <Sheet size={14} />}
                            Exportar para Sheets
                        </button>

                        {exporting && (
                            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
                                Cancelar
                            </button>
                        )}
                    </div>

                    {/* Progress */}
                    {progress && (
                        <div className="export-progress">
                            <Loader2 size={16} className="spin" />
                            <span>{progress.step}</span>
                            {progress.total > 0 && (
                                <span className="progress-count">
                                    {progress.current}/{progress.total}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Data Preview */}
                {previewRows && previewRows.length > 0 && (
                    <div className="export-preview">
                        <h3>Preview ({previewRows.length} notas)</h3>
                        <div className="preview-table-wrapper">
                            <table className="nfe-table export-table">
                                <thead>
                                    <tr>
                                        {HEADER_ROW.map((h) => (
                                            <th key={h}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewRows.slice(0, 10).map((row, i) => (
                                        <tr key={i}>
                                            {row.map((cell, j) => (
                                                <td key={j}>{cell}</td>
                                            ))}
                                        </tr>
                                    ))}
                                    {previewRows.length > 10 && (
                                        <tr>
                                            <td colSpan={HEADER_ROW.length} className="preview-more">
                                                ... e mais {previewRows.length - 10} notas
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
}
