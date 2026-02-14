import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, RefreshCw, Loader2, Inbox, Send, Printer, FileText, FileCheck } from 'lucide-react';
import { listarNfe, obterNfe, enviarNfe } from '../nfeService.js';
import { mockGeneratePDF } from '../mockApi.js';

const SITUACOES = {
    1: { label: 'Pendente', cls: 'badge-pending' },
    2: { label: 'Cancelada', cls: 'badge-cancelled' },
    3: { label: 'Aguardando Recibo', cls: 'badge-waiting' },
    4: { label: 'Rejeitada', cls: 'badge-rejected' },
    5: { label: 'Autorizada', cls: 'badge-authorized' },
    6: { label: 'Emitida DANFE', cls: 'badge-emitted' },
    7: { label: 'Registrada', cls: 'badge-registered' },
    8: { label: 'Aguardando Protocolo', cls: 'badge-waiting' },
    9: { label: 'Denegada', cls: 'badge-rejected' },
    10: { label: 'Consulta Situação', cls: 'badge-waiting' },
    11: { label: 'Bloqueada', cls: 'badge-rejected' },
};

function fmt(v) {
    return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function NfeList({ token, showToast }) {
    const [notas, setNotas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagina, setPagina] = useState(1);
    const [expandedId, setExpandedId] = useState(null);
    const [detailData, setDetailData] = useState({});
    const [actionLoading, setActionLoading] = useState(null);

    const fetchNotas = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listarNfe(token, { pagina });
            setNotas(res?.data || []);
        } catch (err) {
            showToast('Erro ao carregar notas: ' + (err?.data?.error?.message || 'Erro desconhecido'), true);
        } finally {
            setLoading(false);
        }
    }, [token, pagina, showToast]);

    useEffect(() => { fetchNotas(); }, [fetchNotas]);

    async function handleExpand(id) {
        if (expandedId === id) { setExpandedId(null); return; }
        setExpandedId(id);
        if (detailData[id]) return;

        try {
            const res = await obterNfe(token, id);
            setDetailData((prev) => ({ ...prev, [id]: res.data }));
        } catch {
            showToast('Erro ao carregar detalhes', true);
        }
    }

    async function handleEnviar(id) {
        if (!confirm('Deseja enviar esta nota para a SEFAZ?')) return;
        setActionLoading(id);
        try {
            await enviarNfe(token, id);
            showToast('Nota enviada para a SEFAZ!');
            fetchNotas();
            if (detailData[id]) {
                const res = await obterNfe(token, id);
                setDetailData((prev) => ({ ...prev, [id]: res.data }));
            }
        } catch (err) {
            showToast('Erro ao enviar: ' + (err?.data?.error?.message || 'Erro desconhecido'), true);
        } finally {
            setActionLoading(null);
        }
    }

    async function handlePDF(nota) {
        let detail = detailData[nota.id];
        if (!detail) {
            try {
                const res = await obterNfe(token, nota.id);
                detail = res.data;
                setDetailData((prev) => ({ ...prev, [nota.id]: detail }));
            } catch {
                showToast('Erro ao carregar detalhes da nota.', true);
                return;
            }
        }
        const url = detail?.linkPDF || detail?.linkDanfe;
        if (url?.startsWith('mock://')) {
            mockGeneratePDF(detail);
        } else if (url) {
            window.open(url, '_blank');
        } else {
            showToast('PDF não disponível. Envie a nota para a SEFAZ primeiro.', true);
        }
    }

    const sit = (s) => {
        const id = typeof s === 'object' ? s?.id : s;
        return SITUACOES[id] || { label: s?.valor || `Status ${id}`, cls: 'badge-pending' };
    };

    return (
        <div className="list-container">
            <div className="card glass">
                <div className="list-header">
                    <h2 className="card-title"><ClipboardList size={20} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Minhas Notas Fiscais</h2>
                    <button className="btn btn-secondary btn-sm" onClick={fetchNotas} disabled={loading}>
                        {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Atualizar
                    </button>
                </div>

                {loading && notas.length === 0 ? (
                    <div className="empty-state">
                        <span className="spinner large"></span>
                        <p>Carregando notas...</p>
                    </div>
                ) : notas.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon"><Inbox size={48} strokeWidth={1.2} /></span>
                        <p>Nenhuma nota fiscal encontrada.</p>
                    </div>
                ) : (
                    <div className="nfe-table-wrapper">
                        <table className="nfe-table">
                            <thead>
                                <tr>
                                    <th>Número</th>
                                    <th>Data</th>
                                    <th>Contato</th>
                                    <th>Situação</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {notas.map((nota) => {
                                    const s = sit(nota.situacao);
                                    const detail = detailData[nota.id];
                                    const isExpanded = expandedId === nota.id;
                                    const isLoading = actionLoading === nota.id;

                                    return (
                                        <Fragment key={nota.id}>
                                            <tr className={isExpanded ? 'row-expanded' : ''}>
                                                <td className="td-numero">
                                                    <strong>{nota.numero || '—'}</strong>
                                                </td>
                                                <td>{nota.dataEmissao ? new Date(nota.dataEmissao).toLocaleDateString('pt-BR') : '—'}</td>
                                                <td>{nota.contato?.nome || nota.contato?.id || '—'}</td>
                                                <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                                                <td className="td-actions">
                                                    <button className="btn-icon" onClick={() => handleExpand(nota.id)} title="Detalhes">
                                                        {isExpanded ? '▲' : '▼'}
                                                    </button>
                                                    {(nota.situacao === 1 || nota.situacao?.id === 1) && (
                                                        <button
                                                            className="btn btn-sm btn-send"
                                                            onClick={() => handleEnviar(nota.id)}
                                                            disabled={isLoading}
                                                            title="Enviar para SEFAZ"
                                                        >
                                                            {isLoading ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Enviar
                                                        </button>
                                                    )}
                                                    <button
                                                        className="btn btn-sm btn-pdf"
                                                        onClick={() => handlePDF(nota)}
                                                        title="Imprimir PDF"
                                                    >
                                                        <Printer size={14} /> PDF
                                                    </button>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="detail-row">
                                                    <td colSpan={5}>
                                                        {detail ? (
                                                            <div className="detail-panel">
                                                                <div className="detail-grid">
                                                                    <div><strong>ID:</strong> {detail.id}</div>
                                                                    <div><strong>Série:</strong> {detail.serie ?? '—'}</div>
                                                                    <div><strong>Natureza:</strong> {typeof detail.naturezaOperacao === 'object' ? detail.naturezaOperacao?.id : detail.naturezaOperacao || '—'}</div>
                                                                    <div><strong>Valor da Nota:</strong> R$ {fmt(detail.valorNota)}</div>
                                                                </div>
                                                                {(detail.linkPDF || detail.linkDanfe) && (
                                                                    <div className="detail-links">
                                                                        {detail.linkPDF && <a href={detail.linkPDF} target="_blank" rel="noopener" className="btn btn-sm btn-pdf"><FileText size={14} /> Abrir PDF</a>}
                                                                        {detail.linkDanfe && <a href={detail.linkDanfe} target="_blank" rel="noopener" className="btn btn-sm btn-send"><FileCheck size={14} /> DANFE</a>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="detail-loading"><span className="spinner"></span> Carregando...</div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="pagination">
                    <button className="btn btn-secondary btn-sm" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina === 1}>
                        ← Anterior
                    </button>
                    <span className="page-indicator">Página {pagina}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setPagina((p) => p + 1)} disabled={notas.length < 100}>
                        Próxima →
                    </button>
                </div>
            </div>
        </div>
    );
}

function Fragment({ children }) {
    return <>{children}</>;
}
