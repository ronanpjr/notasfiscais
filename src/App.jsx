import { useState, useEffect, useCallback, useRef } from 'react';
import { FilePlus, ClipboardList, Droplets, LogOut, AlertTriangle, CheckCircle2, Sheet } from 'lucide-react';
import Login from './components/Login.jsx';
import NfeForm from './components/NfeForm.jsx';
import NfeList from './components/NfeList.jsx';
import SheetsExport from './components/SheetsExport.jsx';
import { exchangeCodeForToken, refreshAccessToken } from './nfeService.js';

const TABS = [
    { id: 'nova', label: '＋ Nova Nota', icon: <FilePlus size={16} /> },
    { id: 'lista', label: 'Minhas Notas', icon: <ClipboardList size={16} /> },
    { id: 'exportar', label: 'Exportar', icon: <Sheet size={16} /> },
];

function getStored(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
}

function setStored(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

export default function App() {
    const [auth, setAuth] = useState(() => getStored('bling_auth'));
    const [credentials, setCredentials] = useState(() => getStored('bling_credentials'));
    const [tab, setTab] = useState('nova');
    const [toastMsg, setToastMsg] = useState(null);

    const token = auth?.access_token;

    const codeExchanged = useRef(false);

    const showToast = useCallback((msg, isError = false) => {
        setToastMsg({ msg, isError });
        setTimeout(() => setToastMsg(null), 4000);
    }, []);

    // Handle OAuth callback
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (!code || !credentials) return;

        // Guard against StrictMode double-execution — OAuth codes are single-use
        if (codeExchanged.current) return;
        codeExchanged.current = true;

        const redirectUri = window.location.origin + window.location.pathname;

        exchangeCodeForToken(code, credentials.clientId, credentials.clientSecret, redirectUri)
            .then((data) => {
                const authData = { ...data, obtained_at: Date.now() };
                setAuth(authData);
                setStored('bling_auth', authData);
                showToast('Login realizado com sucesso!');
            })
            .catch((err) => {
                codeExchanged.current = false; // Allow retry on failure
                showToast('Erro no login: ' + err.message, true);
            })
            .finally(() => {
                window.history.replaceState({}, '', window.location.pathname);
            });
    }, [credentials, showToast]);

    // Auto-refresh token
    useEffect(() => {
        if (!auth?.refresh_token || !credentials) return;

        const expiresIn = (auth.expires_in || 21600) * 1000;
        const elapsed = Date.now() - (auth.obtained_at || 0);
        const refreshIn = Math.max(expiresIn - elapsed - 60000, 5000);

        const timer = setTimeout(async () => {
            try {
                const data = await refreshAccessToken(auth.refresh_token, credentials.clientId, credentials.clientSecret);
                const authData = { ...data, obtained_at: Date.now() };
                setAuth(authData);
                setStored('bling_auth', authData);
            } catch {
                showToast('Sessão expirada. Faça login novamente.', true);
                handleLogout();
            }
        }, refreshIn);

        return () => clearTimeout(timer);
    }, [auth, credentials, showToast]);

    function handleLogin(creds) {
        setCredentials(creds);
        setStored('bling_credentials', creds);
    }

    function handleLogout() {
        setAuth(null);
        localStorage.removeItem('bling_auth');
    }

    function handleDemoMode() {
        const demoAuth = { access_token: 'DEMO_MODE', obtained_at: Date.now() };
        setAuth(demoAuth);
        setStored('bling_auth', demoAuth);
        showToast('Modo demonstração ativado — chamadas à API não funcionarão.');
    }

    if (!token) {
        return (
            <div className="app">
                <Login credentials={credentials} onLogin={handleLogin} onDemoMode={handleDemoMode} />
                {toastMsg && <Toast {...toastMsg} />}
            </div>
        );
    }

    return (
        <div className="app">
            <header className="header">
                <div className="header-left">
                    <h1 className="logo"><Droplets size={22} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> NFe Leite</h1>
                </div>
                <nav className="tabs">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            className={`tab ${tab === t.id ? 'active' : ''}`}
                            onClick={() => setTab(t.id)}
                        >
                            <span className="tab-icon">{t.icon}</span>
                            {t.label}
                        </button>
                    ))}
                </nav>
                <button className="btn-logout" onClick={handleLogout} title="Sair">
                    Sair <LogOut size={14} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                </button>
            </header>

            <main className="main">
                {tab === 'nova' && <NfeForm token={token} onSuccess={() => { showToast('Nota criada com sucesso!'); setTab('lista'); }} onError={(msg) => showToast(msg, true)} />}
                {tab === 'lista' && <NfeList token={token} showToast={showToast} />}
                {tab === 'exportar' && <SheetsExport token={token} showToast={showToast} />}
            </main>

            {toastMsg && <Toast {...toastMsg} />}
        </div>
    );
}

function Toast({ msg, isError }) {
    return (
        <div className={`toast ${isError ? 'toast-error' : 'toast-success'}`}>
            {isError ? <AlertTriangle size={16} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} /> : <CheckCircle2 size={16} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />} {msg}
        </div>
    );
}
