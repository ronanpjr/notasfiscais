import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Layers, Upload, FileText, BarChart3, Send, CheckCircle2,
    XCircle, Loader, AlertTriangle, Play, Square, Pencil, Search, RefreshCw
} from 'lucide-react';
import { calcular, buildPayload, criarNfe, listarContatos, listarNaturezas, obterContato } from '../nfeService.js';

function fmt(v) {
    return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseJsonInput(text) {
    try {
        const data = JSON.parse(text);
        if (!data.produtores || !Array.isArray(data.produtores)) {
            return { error: 'JSON inválido: campo "produtores" (array) não encontrado.' };
        }
        const produtores = data.produtores.map((p, i) => {
            if (!p.ie || !p.nome || p.total_leite == null) {
                return { error: `Produtor ${i + 1}: campos "ie", "nome" e "total_leite" são obrigatórios.` };
            }
            return {
                id: `${p.ie}-${i}`,
                ie: p.ie,
                nome: p.nome,
                totalLeite: p.total_leite,
                qtdEntregas: p.qtd_entregas || 0,
            };
        });
        const firstError = produtores.find(p => p.error);
        if (firstError) return { error: firstError.error };
        return { produtores, meta: { arquivo: data.arquivo_origem, totalProdutores: data.total_produtores, totalLeite: data.total_geral_leite } };
    } catch (e) {
        return { error: `Erro ao ler JSON: ${e.message}` };
    }
}

// ─── Status constants ─────────────────────────────
const CONTACT_STATUS = { PENDING: 'pending', LOADING: 'loading', FOUND: 'found', NOT_FOUND: 'not_found' };
const SEND_STATUS = { IDLE: 'idle', SENDING: 'sending', SUCCESS: 'success', ERROR: 'error' };

export default function BulkNfe({ token, showToast }) {
    // ─── Input state ──────────────────────────────────
    const [jsonText, setJsonText] = useState('');
    const [inputMode, setInputMode] = useState('file'); // 'file' | 'paste'
    const [valorUnitario, setValorUnitario] = useState('');
    const [naturezas, setNaturezas] = useState([]);
    const [selectedNatureza, setSelectedNatureza] = useState(null);
    const [loadingNaturezas, setLoadingNaturezas] = useState(false);
    const [parseError, setParseError] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [fileName, setFileName] = useState('');

    // ─── Table state ──────────────────────────────────
    const [produtores, setProdutores] = useState([]);       // base data
    const [overrides, setOverrides] = useState({});         // per-row overrides: { [id]: { totalLeite, valorUnitario } }
    const [selected, setSelected] = useState(new Set());    // checked rows
    const [contacts, setContacts] = useState({});            // { [id]: { status, contato } }
    const [meta, setMeta] = useState(null);

    // ─── Send state ───────────────────────────────────
    const [sending, setSending] = useState(false);
    const [sendProgress, setSendProgress] = useState({ current: 0, total: 0 });
    const [sendStatuses, setSendStatuses] = useState({});   // { [id]: { status, error } }
    const [sendError, setSendError] = useState(null);       // { produtorId, message }
    const [paused, setPaused] = useState(false);

    const abortRef = useRef(false);
    const fileInputRef = useRef(null);
    const debounceTimers = useRef({});

    useEffect(() => {
        return () => {
            Object.values(debounceTimers.current).forEach(t => clearTimeout(t));
        };
    }, []);

    const vlr = parseFloat(valorUnitario) || 0;

    // ─── Fetch naturezas on mount ─────────────────────
    useEffect(() => {
        if (!token) return;
        setLoadingNaturezas(true);
        listarNaturezas(token)
            .then((res) => {
                const list = res.data || [];
                setNaturezas(list);
                const compra = list.find(n =>
                    n.descricao?.toLowerCase().includes('compra de mercadoria') || n.padrao === 2
                );
                if (compra) setSelectedNatureza(compra);
            })
            .catch(() => showToast('Erro ao carregar naturezas de operação', true))
            .finally(() => setLoadingNaturezas(false));
    }, [token]);

    // ─── Parse and load JSON ──────────────────────────
    function loadJson(text) {
        setParseError('');
        const result = parseJsonInput(text);
        if (result.error) {
            setParseError(result.error);
            setProdutores([]);
            setMeta(null);
            return;
        }
        setProdutores(result.produtores);
        setMeta(result.meta);
        setSelected(new Set(result.produtores.map(p => p.id)));
        setOverrides({});
        setContacts({});
        setSendStatuses({});
        setSendError(null);
        setSendProgress({ current: 0, total: 0 });

        // Start fetching contacts
        fetchContacts(result.produtores);
    }

    // ─── File handling ────────────────────────────────
    function handleFileUpload(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;
            setJsonText(text);
            loadJson(text);
        };
        reader.readAsText(file);
    }

    function handleDrop(e) {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;
            setJsonText(text);
            loadJson(text);
        };
        reader.readAsText(file);
    }

    function handleDragOver(e) {
        e.preventDefault();
        setDragOver(true);
    }

    function handleDragLeave() {
        setDragOver(false);
    }

    // ─── String normalization for search ─────────────
    function normalizeStr(str) {
        return (str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    // ─── Search single contact in Bling ───────────────
    async function searchContact(id, nameToSearch) {
        const trimmed = (nameToSearch || '').trim();
        if (!trimmed) {
            setContacts(prev => ({
                ...prev,
                [id]: { status: CONTACT_STATUS.NOT_FOUND, contato: null, candidates: [] }
            }));
            return;
        }

        setContacts(prev => ({
            ...prev,
            [id]: { status: CONTACT_STATUS.LOADING, contato: null, candidates: [] }
        }));

        try {
            const res = await listarContatos(token, { pesquisa: trimmed, limite: 10 });
            const list = res.data || [];
            const normSearch = normalizeStr(trimmed);

            // 1. Exact match (case & accent insensitive)
            let found = list.find(c => normalizeStr(c.nome) === normSearch);

            // 2. Substring match
            if (!found && list.length > 0) {
                found = list.find(c => {
                    const normContact = normalizeStr(c.nome);
                    return normContact.includes(normSearch) || normSearch.includes(normContact);
                });
            }

            // 3. Single candidate returned by search
            if (!found && list.length === 1) {
                found = list[0];
            }

            if (found) {
                setContacts(prev => ({
                    ...prev,
                    [id]: { status: CONTACT_STATUS.FOUND, contato: found, candidates: list }
                }));
            } else {
                setContacts(prev => ({
                    ...prev,
                    [id]: { status: CONTACT_STATUS.NOT_FOUND, contato: null, candidates: list }
                }));
            }
        } catch {
            setContacts(prev => ({
                ...prev,
                [id]: { status: CONTACT_STATUS.NOT_FOUND, contato: null, candidates: [] }
            }));
        }
    }

    // ─── Fetch contacts on initial JSON load ──────────
    async function fetchContacts(prods) {
        for (const p of prods) {
            await searchContact(p.id, p.nome);
        }
    }

    // ─── Name editing with debounce ───────────────────
    function handleNameChange(id, newName) {
        setOverrides(prev => ({
            ...prev,
            [id]: { ...prev[id], nome: newName }
        }));

        if (debounceTimers.current[id]) {
            clearTimeout(debounceTimers.current[id]);
        }

        debounceTimers.current[id] = setTimeout(() => {
            searchContact(id, newName);
        }, 450);
    }

    function handleResetName(id, originalName) {
        setOverrides(prev => {
            const next = { ...prev };
            if (next[id]) {
                const { nome, ...rest } = next[id];
                next[id] = rest;
            }
            return next;
        });

        if (debounceTimers.current[id]) {
            clearTimeout(debounceTimers.current[id]);
        }

        searchContact(id, originalName);
    }

    // ─── Computed values per producer ─────────────────
    function getRowValues(p) {
        const ov = overrides[p.id] || {};
        const nome = ov.nome != null ? ov.nome : p.nome;
        const litros = ov.totalLeite != null ? ov.totalLeite : p.totalLeite;
        const valor = ov.valorUnitario != null ? ov.valorUnitario : vlr;
        const calc = calcular(litros, valor);
        const isNameCustomized = ov.nome != null && ov.nome !== p.nome;
        const isCustomized = ov.totalLeite != null || ov.valorUnitario != null || isNameCustomized;
        return { nome, litros, valor, calc, isCustomized, isNameCustomized };
    }

    // ─── Overrides ────────────────────────────────────
    function setOverride(id, field, value) {
        setOverrides(prev => ({
            ...prev,
            [id]: { ...prev[id], [field]: value === '' ? undefined : parseFloat(value) || 0 }
        }));
    }

    // ─── Selection ────────────────────────────────────
    function toggleSelect(id) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function toggleSelectAll() {
        if (selected.size === produtores.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(produtores.map(p => p.id)));
        }
    }

    // ─── Summary ──────────────────────────────────────
    const summary = useMemo(() => {
        let totalLitros = 0, totalNotas = 0, count = 0;
        produtores.forEach(p => {
            if (!selected.has(p.id)) return;
            const { litros, calc } = getRowValues(p);
            totalLitros += litros;
            totalNotas += calc.totalNota;
            count++;
        });
        return { totalLitros, totalNotas, count };
    }, [produtores, selected, overrides, vlr]);

    // ─── Determine if can send ────────────────────────
    const selectedProdutores = produtores.filter(p => selected.has(p.id));
    const allSelectedHaveContacts = selectedProdutores.every(p =>
        contacts[p.id]?.status === CONTACT_STATUS.FOUND
    );
    const canSend = selectedProdutores.length > 0 && allSelectedHaveContacts && vlr > 0 && selectedNatureza && !sending;

    // ─── Send all selected ────────────────────────────
    async function handleSendAll() {
        if (!canSend) return;

        const toSend = [...selectedProdutores];
        setSending(true);
        setSendProgress({ current: 0, total: toSend.length });
        setSendError(null);
        abortRef.current = false;

        for (let i = 0; i < toSend.length; i++) {
            if (abortRef.current) break;

            const p = toSend[i];
            const contactData = contacts[p.id]?.contato;
            if (!contactData) continue;

            setSendStatuses(prev => ({ ...prev, [p.id]: { status: SEND_STATUS.SENDING } }));

            try {
                // Fetch full contact for address
                let fullContato = contactData;
                try {
                    const cRes = await obterContato(token, contactData.id);
                    if (cRes?.data) fullContato = { ...contactData, ...cRes.data };
                } catch { /* use basic data */ }

                const { litros, valor, nome } = getRowValues(p);
                const payload = buildPayload({
                    contato: fullContato,
                    naturezaOperacaoId: selectedNatureza.id,
                    quantidade: litros,
                    valorUnitario: valor,
                });

                await criarNfe(token, payload);

                setSendStatuses(prev => ({ ...prev, [p.id]: { status: SEND_STATUS.SUCCESS } }));
                setSendProgress(prev => ({ ...prev, current: prev.current + 1 }));
            } catch (err) {
                const msg = err?.data?.error?.fields?.[0]?.msg
                    || err?.data?.error?.message
                    || err?.data?.error?.description
                    || 'Erro desconhecido ao criar nota fiscal.';

                setSendStatuses(prev => ({ ...prev, [p.id]: { status: SEND_STATUS.ERROR, error: msg } }));
                setSendError({ produtorId: p.id, produtorNome: nome, message: msg, index: i });
                setPaused(true);
                return; // Stop execution — user decides
            }
        }

        if (!abortRef.current) {
            setSending(false);
            showToast(`${sendProgress.current + (abortRef.current ? 0 : 1)} nota(s) criada(s) com sucesso!`);
        }
    }

    function handleContinue() {
        // Resume from where we left off
        setPaused(false);
        setSendError(null);

        const toSend = [...selectedProdutores];
        const errorIndex = toSend.findIndex(p => p.id === sendError?.produtorId);
        if (errorIndex === -1) { setSending(false); return; }

        // Continue with remaining (skip the errored one)
        const remaining = toSend.slice(errorIndex + 1);
        if (remaining.length === 0) { setSending(false); return; }

        continueFrom(remaining);
    }

    async function continueFrom(toSend) {
        setSendError(null);
        abortRef.current = false;

        for (let i = 0; i < toSend.length; i++) {
            if (abortRef.current) break;

            const p = toSend[i];
            const contactData = contacts[p.id]?.contato;
            if (!contactData) continue;

            setSendStatuses(prev => ({ ...prev, [p.id]: { status: SEND_STATUS.SENDING } }));

            try {
                let fullContato = contactData;
                try {
                    const cRes = await obterContato(token, contactData.id);
                    if (cRes?.data) fullContato = { ...contactData, ...cRes.data };
                } catch { /* use basic data */ }

                const { litros, valor, nome } = getRowValues(p);
                const payload = buildPayload({
                    contato: fullContato,
                    naturezaOperacaoId: selectedNatureza.id,
                    quantidade: litros,
                    valorUnitario: valor,
                });

                await criarNfe(token, payload);

                setSendStatuses(prev => ({ ...prev, [p.id]: { status: SEND_STATUS.SUCCESS } }));
                setSendProgress(prev => ({ ...prev, current: prev.current + 1 }));
            } catch (err) {
                const msg = err?.data?.error?.fields?.[0]?.msg
                    || err?.data?.error?.message
                    || err?.data?.error?.description
                    || 'Erro desconhecido ao criar nota fiscal.';

                setSendStatuses(prev => ({ ...prev, [p.id]: { status: SEND_STATUS.ERROR, error: msg } }));
                setSendError({ produtorId: p.id, produtorNome: nome, message: msg, index: i });
                setPaused(true);
                return;
            }
        }

        if (!abortRef.current) {
            setSending(false);
            showToast('Notas restantes criadas com sucesso!');
        }
    }

    function handleAbort() {
        abortRef.current = true;
        setSending(false);
        setPaused(false);
        setSendError(null);
        showToast('Envio cancelado pelo usuário.', true);
    }

    // ─── Progress percentage ──────────────────────────
    const progressPercent = sendProgress.total > 0
        ? Math.round((sendProgress.current / sendProgress.total) * 100)
        : 0;

    // ─── Check if any contacts are still loading ──────
    const contactsLoading = produtores.some(p => contacts[p.id]?.status === CONTACT_STATUS.LOADING);

    const hasData = produtores.length > 0;

    return (
        <div className="bulk-container">
            <div className="card glass">
                <h2 className="card-title">
                    <Layers size={20} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
                    Notas em Lote
                </h2>
                <p className="card-desc">
                    Carregue um arquivo JSON com os totais dos produtores, defina o valor unitário do leite e crie todas as notas fiscais de uma vez.
                </p>

                {/* ─── Input Section ──────────────────────────── */}
                <div className="bulk-input-section">
                    <div className="bulk-input-row">
                        {/* Mode toggle */}
                        <div className="bulk-mode-toggle">
                            <button
                                className={`bulk-mode-btn ${inputMode === 'file' ? 'active' : ''}`}
                                onClick={() => setInputMode('file')}
                                type="button"
                            >
                                <Upload size={14} /> Upload
                            </button>
                            <button
                                className={`bulk-mode-btn ${inputMode === 'paste' ? 'active' : ''}`}
                                onClick={() => setInputMode('paste')}
                                type="button"
                            >
                                <FileText size={14} /> Colar JSON
                            </button>
                        </div>
                    </div>

                    {inputMode === 'file' ? (
                        <div
                            className={`bulk-dropzone ${dragOver ? 'drag-over' : ''} ${fileName ? 'has-file' : ''}`}
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".json"
                                onChange={handleFileUpload}
                                style={{ display: 'none' }}
                            />
                            {fileName ? (
                                <div className="dropzone-loaded">
                                    <CheckCircle2 size={20} className="dropzone-icon-ok" />
                                    <span className="dropzone-filename">{fileName}</span>
                                    <span className="dropzone-hint">Clique para trocar</span>
                                </div>
                            ) : (
                                <div className="dropzone-empty">
                                    <Upload size={28} className="dropzone-icon" />
                                    <span className="dropzone-text">Arraste um arquivo .json aqui</span>
                                    <span className="dropzone-hint">ou clique para selecionar</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bulk-paste-area">
                            <textarea
                                className="bulk-textarea"
                                placeholder='Cole o conteúdo do JSON aqui (formato totais.json)...'
                                value={jsonText}
                                onChange={(e) => setJsonText(e.target.value)}
                                rows={6}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => loadJson(jsonText)}
                                disabled={!jsonText.trim()}
                            >
                                Carregar JSON
                            </button>
                        </div>
                    )}

                    {parseError && (
                        <div className="bulk-error-msg">
                            <AlertTriangle size={14} /> {parseError}
                        </div>
                    )}

                    <div className="bulk-config-row">
                        <div className="field">
                            <label htmlFor="bulk-valor">Valor Unitário do Leite (R$/litro)</label>
                            <input
                                id="bulk-valor"
                                type="number"
                                value={valorUnitario}
                                onChange={(e) => setValorUnitario(e.target.value)}
                                placeholder="Ex: 2.25"
                                step="0.01"
                                min="0.01"
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="bulk-natureza">Natureza de Operação</label>
                            <select
                                id="bulk-natureza"
                                value={selectedNatureza?.id || ''}
                                onChange={(e) => {
                                    const nat = naturezas.find(n => n.id === Number(e.target.value));
                                    setSelectedNatureza(nat || null);
                                }}
                                disabled={loadingNaturezas}
                            >
                                <option value="">{loadingNaturezas ? 'Carregando...' : 'Selecione'}</option>
                                {naturezas.map((n) => (
                                    <option key={n.id} value={n.id}>{n.descricao}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* ─── Preview Table ─────────────────────────── */}
                {hasData && (
                    <div className="bulk-preview" style={{ animation: 'slideIn 0.3s ease' }}>
                        <div className="bulk-preview-header">
                            <h3>
                                <BarChart3 size={18} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
                                Prévia — {produtores.length} produtores
                                {meta?.arquivo && <span className="bulk-meta-file"> ({meta.arquivo})</span>}
                            </h3>
                            {contactsLoading && (
                                <span className="bulk-contacts-loading">
                                    <Loader size={14} className="spin" /> Validando contatos...
                                </span>
                            )}
                        </div>

                        <div className="bulk-table-wrapper">
                            <table className="nfe-table bulk-table">
                                <thead>
                                    <tr>
                                        <th className="th-check">
                                            <input
                                                type="checkbox"
                                                checked={selected.size === produtores.length}
                                                onChange={toggleSelectAll}
                                                title="Selecionar todos"
                                            />
                                        </th>
                                        <th>Produtor</th>
                                        <th>IE</th>
                                        <th className="th-number">Litros</th>
                                        <th className="th-number">Valor Unit.</th>
                                        <th className="th-number">Total Prod.</th>
                                        <th className="th-number">Desp. 2,5%</th>
                                        <th className="th-number">ICMS 12%</th>
                                        <th className="th-number">Funrural 1,5%</th>
                                        <th className="th-number">Total Nota</th>
                                        <th className="th-status">Contato Bling</th>
                                        {sending && <th className="th-status">Status</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {produtores.map((p) => {
                                        const { nome, litros, valor, calc, isCustomized, isNameCustomized } = getRowValues(p);
                                        const isSelected = selected.has(p.id);
                                        const contactData = contacts[p.id];
                                        const contactStatus = contactData?.status || CONTACT_STATUS.PENDING;
                                        const sendStatus = sendStatuses[p.id];

                                        return (
                                            <tr
                                                key={p.id}
                                                className={`
                                                    ${!isSelected ? 'row-deselected' : ''}
                                                    ${isCustomized ? 'row-customized' : ''}
                                                    ${isSelected && contactStatus === CONTACT_STATUS.NOT_FOUND ? 'row-not-found-warning' : ''}
                                                    ${sendStatus?.status === SEND_STATUS.SUCCESS ? 'row-success' : ''}
                                                    ${sendStatus?.status === SEND_STATUS.ERROR ? 'row-error' : ''}
                                                `}
                                            >
                                                <td className="td-check">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleSelect(p.id)}
                                                    />
                                                </td>
                                                <td className="td-editable td-nome-cell">
                                                    <div className="nome-input-wrapper">
                                                        <input
                                                            type="text"
                                                            className={`inline-input inline-input-name ${isNameCustomized ? 'input-customized' : ''}`}
                                                            value={overrides[p.id]?.nome ?? p.nome}
                                                            onChange={(e) => handleNameChange(p.id, e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.target.blur();
                                                                    searchContact(p.id, e.target.value);
                                                                }
                                                            }}
                                                            title={isNameCustomized ? `Nome original no JSON: ${p.nome}` : 'Edite o nome para pesquisar no Bling'}
                                                            placeholder="Nome no Bling"
                                                        />
                                                        <div className="nome-input-actions">
                                                            {isNameCustomized && (
                                                                <button
                                                                    type="button"
                                                                    className="btn-reset-name"
                                                                    onClick={() => handleResetName(p.id, p.nome)}
                                                                    title={`Restaurar nome original: ${p.nome}`}
                                                                >
                                                                    ✕
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                className="btn-search-name"
                                                                onClick={() => searchContact(p.id, overrides[p.id]?.nome ?? p.nome)}
                                                                title="Pesquisar este nome no Bling"
                                                            >
                                                                {contactStatus === CONTACT_STATUS.LOADING ? (
                                                                    <Loader size={11} className="spin" />
                                                                ) : (
                                                                    <Search size={11} />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="td-ie">{p.ie}</td>
                                                <td className="td-editable">
                                                    <input
                                                        type="number"
                                                        className="inline-input"
                                                        value={overrides[p.id]?.totalLeite ?? p.totalLeite}
                                                        onChange={(e) => setOverride(p.id, 'totalLeite', e.target.value)}
                                                        step="0.01"
                                                        min="0"
                                                    />
                                                </td>
                                                <td className="td-editable">
                                                    <input
                                                        type="number"
                                                        className="inline-input"
                                                        value={overrides[p.id]?.valorUnitario ?? vlr}
                                                        onChange={(e) => setOverride(p.id, 'valorUnitario', e.target.value)}
                                                        step="0.01"
                                                        min="0"
                                                        placeholder={vlr ? fmt(vlr) : '—'}
                                                    />
                                                </td>
                                                <td className="td-number">R$ {fmt(calc.totalProdutos)}</td>
                                                <td className="td-number">R$ {fmt(calc.despesas)}</td>
                                                <td className="td-number">R$ {fmt(calc.icms)}</td>
                                                <td className="td-number">R$ {fmt(calc.funrural)}</td>
                                                <td className="td-number td-total">R$ {fmt(calc.totalNota)}</td>
                                                <td className="td-contact-status">
                                                    {contactStatus === CONTACT_STATUS.LOADING && (
                                                        <span className="contact-loading"><Loader size={12} className="spin" /> Buscando...</span>
                                                    )}
                                                    {contactStatus === CONTACT_STATUS.FOUND && (
                                                        <div className="contact-status-col">
                                                            <span className="contact-found" title={`Contato Bling: ${contactData?.contato?.nome} (ID: ${contactData?.contato?.id})`}>
                                                                <CheckCircle2 size={12} /> {contactData?.contato?.nome || 'Encontrado'}
                                                            </span>
                                                            {contactData?.candidates?.length > 1 && (
                                                                <select
                                                                    className="contact-select-candidate"
                                                                    value={contactData.contato?.id || ''}
                                                                    onChange={(e) => {
                                                                        const chosen = contactData.candidates.find(c => String(c.id) === e.target.value);
                                                                        if (chosen) {
                                                                            setContacts(prev => ({
                                                                                ...prev,
                                                                                [p.id]: { ...prev[p.id], contato: chosen, status: CONTACT_STATUS.FOUND }
                                                                            }));
                                                                        }
                                                                    }}
                                                                    title="Trocar contato selecionado"
                                                                >
                                                                    {contactData.candidates.map(c => (
                                                                        <option key={c.id} value={c.id}>{c.nome}</option>
                                                                    ))}
                                                                </select>
                                                            )}
                                                        </div>
                                                    )}
                                                    {contactStatus === CONTACT_STATUS.NOT_FOUND && (
                                                        <div className="contact-status-col">
                                                            <span className="contact-not-found" title="Não encontrado no Bling. Altere o nome na coluna ao lado para buscar.">
                                                                <XCircle size={12} /> Não encontrado
                                                            </span>
                                                            {contactData?.candidates?.length > 0 ? (
                                                                <select
                                                                    className="contact-select-candidate not-found"
                                                                    defaultValue=""
                                                                    onChange={(e) => {
                                                                        const chosen = contactData.candidates.find(c => String(c.id) === e.target.value);
                                                                        if (chosen) {
                                                                            setContacts(prev => ({
                                                                                ...prev,
                                                                                [p.id]: { ...prev[p.id], contato: chosen, status: CONTACT_STATUS.FOUND }
                                                                            }));
                                                                        }
                                                                    }}
                                                                    title="Selecione uma das sugestões encontradas no Bling"
                                                                >
                                                                    <option value="" disabled>Vincular a ({contactData.candidates.length} sugestões)...</option>
                                                                    {contactData.candidates.map(c => (
                                                                        <option key={c.id} value={c.id}>{c.nome}</option>
                                                                    ))}
                                                                </select>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    className="btn-retry-search"
                                                                    onClick={() => searchContact(p.id, overrides[p.id]?.nome ?? p.nome)}
                                                                    title="Buscar este produtor no Bling"
                                                                >
                                                                    <RefreshCw size={10} /> Buscar no Bling
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                    {contactStatus === CONTACT_STATUS.PENDING && (
                                                        <span className="contact-pending">—</span>
                                                    )}
                                                </td>
                                                {sending && (
                                                    <td className="td-send-status">
                                                        {sendStatus?.status === SEND_STATUS.SENDING && (
                                                            <span className="send-sending"><Loader size={12} className="spin" /> Enviando...</span>
                                                        )}
                                                        {sendStatus?.status === SEND_STATUS.SUCCESS && (
                                                            <span className="send-success"><CheckCircle2 size={12} /> Criada</span>
                                                        )}
                                                        {sendStatus?.status === SEND_STATUS.ERROR && (
                                                            <span className="send-error" title={sendStatus.error}>
                                                                <XCircle size={12} /> Erro
                                                            </span>
                                                        )}
                                                        {!sendStatus && <span className="send-idle">—</span>}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="bulk-totals-row">
                                        <td colSpan={3} className="td-totals-label">
                                            Totais ({summary.count} selecionado{summary.count !== 1 ? 's' : ''})
                                        </td>
                                        <td className="td-number td-total-foot">{fmt(summary.totalLitros)} L</td>
                                        <td></td>
                                        <td colSpan={4}></td>
                                        <td className="td-number td-total-foot highlight">R$ {fmt(summary.totalNotas)}</td>
                                        <td></td>
                                        {sending && <td></td>}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* ─── Error Banner ──────────────────────── */}
                        {sendError && paused && (
                            <div className="bulk-error-banner" style={{ animation: 'slideIn 0.2s ease' }}>
                                <div className="bulk-error-content">
                                    <AlertTriangle size={18} />
                                    <div>
                                        <strong>Erro ao criar nota de {sendError.produtorNome}:</strong>
                                        <p>{sendError.message}</p>
                                    </div>
                                </div>
                                <div className="bulk-error-actions">
                                    <button className="btn btn-primary btn-sm" onClick={handleContinue}>
                                        <Play size={14} /> Continuar
                                    </button>
                                    <button className="btn btn-secondary btn-sm" onClick={handleAbort}>
                                        <Square size={14} /> Cancelar
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ─── Progress Bar ──────────────────────── */}
                        {sending && (
                            <div className="bulk-progress" style={{ animation: 'slideIn 0.2s ease' }}>
                                <div className="bulk-progress-bar">
                                    <div
                                        className="bulk-progress-fill"
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                                <span className="bulk-progress-text">
                                    {sendProgress.current} de {sendProgress.total} notas criadas
                                </span>
                            </div>
                        )}

                        {/* ─── Send Button ───────────────────────── */}
                        <div className="bulk-actions">
                            {!sending ? (
                                <button
                                    className="btn btn-primary btn-block"
                                    onClick={handleSendAll}
                                    disabled={!canSend}
                                >
                                    <Send size={16} />
                                    Criar {summary.count} Nota{summary.count !== 1 ? 's' : ''} Selecionada{summary.count !== 1 ? 's' : ''}
                                </button>
                            ) : (
                                <button
                                    className="btn btn-secondary btn-block"
                                    onClick={handleAbort}
                                    disabled={paused}
                                >
                                    <Square size={16} /> Cancelar Envio
                                </button>
                            )}
                            {!allSelectedHaveContacts && selectedProdutores.length > 0 && !contactsLoading && (
                                <p className="bulk-hint-error">
                                    <XCircle size={13} /> Alguns produtores selecionados não foram encontrados no Bling. Desmarque-os ou corrija os nomes.
                                </p>
                            )}
                            {vlr <= 0 && hasData && (
                                <p className="bulk-hint-error">
                                    <AlertTriangle size={13} /> Defina o valor unitário do leite acima.
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
