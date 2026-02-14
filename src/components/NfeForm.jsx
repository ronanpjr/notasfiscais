import { useState, useEffect, useMemo, useRef } from 'react';
import { FilePlus, BarChart3, Save, Search, ChevronDown } from 'lucide-react';
import { calcular, buildPayload, criarNfe, listarContatos, listarNaturezas } from '../nfeService.js';

function fmt(v) {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function NfeForm({ token, onSuccess, onError }) {
    const [contatos, setContatos] = useState([]);
    const [naturezas, setNaturezas] = useState([]);
    const [loadingContatos, setLoadingContatos] = useState(false);
    const [loadingNaturezas, setLoadingNaturezas] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedContato, setSelectedContato] = useState(null);
    const [selectedNatureza, setSelectedNatureza] = useState(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [quantidade, setQuantidade] = useState('');
    const [valorUnitario, setValorUnitario] = useState('');
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef(null);

    const qtd = parseFloat(quantidade) || 0;
    const vlr = parseFloat(valorUnitario) || 0;
    const calc = useMemo(() => calcular(qtd, vlr), [qtd, vlr]);
    const hasValues = qtd > 0 && vlr > 0;

    // Fetch contacts and naturezas on mount
    useEffect(() => {
        if (!token) return;

        setLoadingContatos(true);
        listarContatos(token, { limite: 200 })
            .then((res) => setContatos(res.data || []))
            .catch(() => onError('Erro ao carregar contatos'))
            .finally(() => setLoadingContatos(false));

        setLoadingNaturezas(true);
        listarNaturezas(token)
            .then((res) => {
                const list = res.data || [];
                setNaturezas(list);
                // Auto-select "Compra de mercadorias" or the padrao=2 (padrão compra)
                const compra = list.find(n =>
                    n.descricao?.toLowerCase().includes('compra de mercadoria') || n.padrao === 2
                );
                if (compra) setSelectedNatureza(compra);
            })
            .catch(() => onError('Erro ao carregar naturezas de operação'))
            .finally(() => setLoadingNaturezas(false));
    }, [token]);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const filtered = useMemo(() => {
        if (!search) return contatos;
        const q = search.toLowerCase();
        return contatos.filter(c =>
            c.nome?.toLowerCase().includes(q) ||
            c.numeroDocumento?.includes(q)
        );
    }, [contatos, search]);

    function selectContato(c) {
        setSelectedContato(c);
        setSearch('');
        setDropdownOpen(false);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!selectedContato || !selectedNatureza || !hasValues) return;

        setLoading(true);
        try {
            const payload = buildPayload({
                contato: selectedContato,
                naturezaOperacaoId: selectedNatureza.id,
                quantidade: qtd,
                valorUnitario: vlr,
            });
            await criarNfe(token, payload);
            setSelectedContato(null);
            setQuantidade('');
            setValorUnitario('');
            onSuccess();
        } catch (err) {
            const msg = err?.data?.error?.fields?.[0]?.msg || err?.data?.error?.message || err?.data?.error?.description || 'Erro ao criar nota fiscal.';
            onError(msg);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="form-container">
            <div className="card glass">
                <h2 className="card-title"><FilePlus size={20} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Nova Nota Fiscal</h2>
                <p className="card-desc">Preencha os dados abaixo para criar uma NFe de compra de leite. A nota será salva como rascunho no Bling, disponível para revisão e alterações antes da emissão.</p>

                <form onSubmit={handleSubmit} className="nfe-form">
                    <div className="form-grid">
                        {/* Contact Selector */}
                        <div className="field field-full" ref={dropdownRef}>
                            <label htmlFor="contato">Produtor / Fornecedor</label>
                            {selectedContato ? (
                                <div className="selected-contato" onClick={() => { setSelectedContato(null); setDropdownOpen(true); }}>
                                    <span className="contato-name">{selectedContato.nome}</span>
                                    <span className="contato-doc">{selectedContato.numeroDocumento || 'Sem CPF/CNPJ'}</span>
                                    <ChevronDown size={16} className="contato-chevron" />
                                </div>
                            ) : (
                                <div className="contato-search-wrapper">
                                    <Search size={16} className="search-icon" />
                                    <input
                                        id="contato"
                                        type="text"
                                        value={search}
                                        onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
                                        onFocus={() => setDropdownOpen(true)}
                                        placeholder={loadingContatos ? 'Carregando contatos...' : 'Buscar por nome ou CPF/CNPJ...'}
                                        disabled={loadingContatos}
                                        autoComplete="off"
                                    />
                                </div>
                            )}

                            {dropdownOpen && !selectedContato && (
                                <ul className="contato-dropdown">
                                    {filtered.length === 0 ? (
                                        <li className="contato-empty">
                                            {loadingContatos ? 'Carregando...' : 'Nenhum contato encontrado'}
                                        </li>
                                    ) : (
                                        filtered.slice(0, 20).map((c) => (
                                            <li key={c.id} className="contato-option" onClick={() => selectContato(c)}>
                                                <span className="contato-name">{c.nome}</span>
                                                <span className="contato-doc">{c.numeroDocumento || '—'}</span>
                                            </li>
                                        ))
                                    )}
                                    {filtered.length > 20 && (
                                        <li className="contato-empty">Mais {filtered.length - 20} resultados — refine a busca</li>
                                    )}
                                </ul>
                            )}
                        </div>

                        {/* Natureza de Operação */}
                        <div className="field field-full">
                            <label htmlFor="natureza">Natureza de Operação</label>
                            <select
                                id="natureza"
                                value={selectedNatureza?.id || ''}
                                onChange={(e) => {
                                    const nat = naturezas.find(n => n.id === Number(e.target.value));
                                    setSelectedNatureza(nat || null);
                                }}
                                disabled={loadingNaturezas}
                            >
                                <option value="">{loadingNaturezas ? 'Carregando...' : 'Selecione a natureza de operação'}</option>
                                {naturezas.map((n) => (
                                    <option key={n.id} value={n.id}>{n.descricao}</option>
                                ))}
                            </select>
                        </div>

                        <div className="field">
                            <label htmlFor="quantidade">Quantidade (Litros)</label>
                            <input
                                id="quantidade"
                                type="number"
                                value={quantidade}
                                onChange={(e) => setQuantidade(e.target.value)}
                                placeholder="Ex: 2894.00"
                                step="0.01"
                                min="0.01"
                                required
                            />
                        </div>

                        <div className="field">
                            <label htmlFor="valorUnitario">Valor Unitário (R$)</label>
                            <input
                                id="valorUnitario"
                                type="number"
                                value={valorUnitario}
                                onChange={(e) => setValorUnitario(e.target.value)}
                                placeholder="Ex: 2.25"
                                step="0.01"
                                min="0.01"
                                required
                            />
                        </div>
                    </div>

                    {hasValues && (
                        <div className="preview-panel">
                            <h3><BarChart3 size={18} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Prévia dos Cálculos</h3>
                            <div className="preview-grid">
                                <div className="preview-item">
                                    <span className="preview-label">Total Produtos</span>
                                    <span className="preview-value">R$ {fmt(calc.totalProdutos)}</span>
                                </div>
                                <div className="preview-item accent">
                                    <span className="preview-label">Despesas Acessórias (2,5%)</span>
                                    <span className="preview-value">+ R$ {fmt(calc.despesas)}</span>
                                </div>
                                <div className="preview-item">
                                    <span className="preview-label">ICMS (12%)</span>
                                    <span className="preview-value">R$ {fmt(calc.icms)}</span>
                                </div>
                                <div className="preview-item info">
                                    <span className="preview-label">Funrural (1,5%) — informativo</span>
                                    <span className="preview-value">R$ {fmt(calc.funrural)}</span>
                                </div>
                                <div className="preview-item total">
                                    <span className="preview-label">Total da Nota</span>
                                    <span className="preview-value highlight">R$ {fmt(calc.totalNota)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <button type="submit" className="btn btn-primary btn-block" disabled={loading || !hasValues || !selectedContato || !selectedNatureza}>
                        {loading ? (
                            <><span className="spinner"></span> Criando...</>
                        ) : (
                            <><Save size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Criar Nota Fiscal</>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
