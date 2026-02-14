const API_BASE = '/api';
const OAUTH_BASE = '/oauth';

// ─── OAuth2 ───────────────────────────────────────────────
export function getAuthUrl(clientId, redirectUri) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        state: crypto.randomUUID(),
    });
    return `https://bling.com.br/Api/v3/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(code, clientId, clientSecret, redirectUri) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
    });

    const res = await fetch(`${OAUTH_BASE}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        },
        body,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error_description || `OAuth error ${res.status}`);
    }
    return res.json();
}

export async function refreshAccessToken(refreshToken, clientId, clientSecret) {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });

    const res = await fetch(`${OAUTH_BASE}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        },
        body,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error_description || `Refresh error ${res.status}`);
    }
    return res.json();
}

// ─── NFe Payload Builder ──────────────────────────────────
function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nowFormatted() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

export function calcular(quantidade, valorUnitario) {
    const totalProdutos = round2(quantidade * valorUnitario);
    const despesas = round2(totalProdutos * 0.025);
    const icms = round2(totalProdutos * 0.12);
    const funrural = round2(totalProdutos * 0.015);
    const totalNota = round2(totalProdutos + despesas);
    return { totalProdutos, despesas, icms, funrural, totalNota };
}

export function buildPayload({ contato, naturezaOperacaoId, quantidade, valorUnitario }) {
    const { totalProdutos, despesas, icms, funrural } = calcular(quantidade, valorUnitario);
    const agora = nowFormatted();

    const observacoes = `Operação tributada nos termos do art 296 da parte 1 do Anexo VIII do RICMS e o valor acrescentado à operação a título de incentivo à produção e à industrialização do leite 2,5% retenções federais FUNRURAL 1,5% base de cálculo (valor dos produtos) * 1,5% = R$ ${formatCurrency(funrural)}`;

    return {
        tipo: 0,
        numero: "0",
        dataEmissao: agora,
        dataOperacao: agora,
        naturezaOperacao: { id: naturezaOperacaoId },
        finalidade: 1,
        contato: {
            id: contato.id,
            nome: contato.nome,
            tipoPessoa: 'F',
            numeroDocumento: (contato.numeroDocumento || '').replace(/\D/g, ''),
            contribuinte: 1,
        },
        despesas,
        itens: [
            {
                codigo: "01",
                descricao: "Leite Cru",
                unidade: "LT",
                quantidade: Number(quantidade),
                valor: Number(valorUnitario),
                tipo: "P",
                origem: 0,
                classificacaoFiscal: "04012090",
            },
        ],
        transporte: { fretePorConta: 9 },
        observacoes,
    };
}

// ─── API Calls ────────────────────────────────────────────
import { mockCriarNfe, mockListarNfe, mockObterNfe, mockEnviarNfe } from './mockApi.js';

const IS_DEMO = (token) => token === 'DEMO_MODE';

async function apiFetch(token, path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        },
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw { status: res.status, data: err };
    }

    if (res.status === 204) return null;
    return res.json();
}

export function criarNfe(token, payload) {
    if (IS_DEMO(token)) return mockCriarNfe(payload);
    return apiFetch(token, '/nfe', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export function listarNfe(token, { pagina = 1, limite = 100, situacao, tipo = 0 } = {}) {
    if (IS_DEMO(token)) return mockListarNfe({ pagina, limite });
    const params = new URLSearchParams({ pagina, limite, tipo });
    if (situacao) params.set('situacao', situacao);
    return apiFetch(token, `/nfe?${params}`);
}

export function obterNfe(token, id) {
    if (IS_DEMO(token)) return mockObterNfe(id);
    return apiFetch(token, `/nfe/${id}`);
}

export function enviarNfe(token, id) {
    if (IS_DEMO(token)) return mockEnviarNfe(id);
    return apiFetch(token, `/nfe/${id}/enviar`, { method: 'POST' });
}

export function listarContatos(token, { pagina = 1, limite = 100, pesquisa, tipoPessoa } = {}) {
    if (IS_DEMO(token)) {
        const mockContatos = [
            { id: 987654321, nome: 'João da Silva', numeroDocumento: '123.456.789-00', situacao: 'A' },
            { id: 123456789, nome: 'Maria Oliveira', numeroDocumento: '987.654.321-00', situacao: 'A' },
            { id: 555111222, nome: 'Carlos Souza', numeroDocumento: '456.789.123-00', situacao: 'A' },
        ];
        const filtered = pesquisa
            ? mockContatos.filter(c => c.nome.toLowerCase().includes(pesquisa.toLowerCase()))
            : mockContatos;
        return Promise.resolve({ data: filtered });
    }
    const params = new URLSearchParams({ pagina, limite, criterio: 1 });
    if (pesquisa) params.set('pesquisa', pesquisa);
    if (tipoPessoa) params.set('tipoPessoa', tipoPessoa);
    return apiFetch(token, `/contatos?${params}`);
}

export function listarNaturezas(token, { pagina = 1, limite = 100, situacao = 1 } = {}) {
    if (IS_DEMO(token)) {
        return Promise.resolve({
            data: [
                { id: 1001, descricao: 'Compra de mercadorias', padrao: 2, situacao: 1 },
                { id: 1002, descricao: 'Venda de produção', padrao: 1, situacao: 1 },
                { id: 1003, descricao: 'Devolução', padrao: 8, situacao: 1 },
            ]
        });
    }
    const params = new URLSearchParams({ pagina, limite, situacao });
    return apiFetch(token, `/naturezas-operacoes?${params}`);
}
