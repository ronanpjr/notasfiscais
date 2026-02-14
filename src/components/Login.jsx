import { useState } from 'react';
import { Droplets, Lock, Settings, Eye, EyeOff, Monitor } from 'lucide-react';
import { getAuthUrl } from '../nfeService.js';

export default function Login({ credentials, onLogin, onDemoMode }) {
    const [clientId, setClientId] = useState(credentials?.clientId || '');
    const [clientSecret, setClientSecret] = useState(credentials?.clientSecret || '');
    const [showConfig, setShowConfig] = useState(!credentials?.clientId);
    const [showSecret, setShowSecret] = useState(false);

    const isConfigured = clientId.trim() && clientSecret.trim();

    function handleSaveConfig(e) {
        e.preventDefault();
        if (!isConfigured) return;
        onLogin({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
        setShowConfig(false);
    }

    function handleConnect() {
        const creds = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
        onLogin(creds);
        const redirectUri = window.location.origin + window.location.pathname;
        window.location.href = getAuthUrl(creds.clientId, redirectUri);
    }

    return (
        <div className="login-container">
            <div className="login-card glass">
                <div className="login-header">
                    <span className="login-icon"><Droplets size={48} strokeWidth={1.5} /></span>
                    <h1>NFe Leite</h1>
                    <p className="login-subtitle">Emissão de Notas Fiscais de Leite</p>
                </div>

                {/* Main login button */}
                <div className="login-main">
                    <button
                        className="btn btn-primary btn-block btn-lg"
                        onClick={handleConnect}
                        disabled={!isConfigured}
                    >
                        <Lock size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Entrar com Bling
                    </button>
                    <p className="login-hint">
                        Você será redirecionado ao Bling para fazer login com seu e-mail e senha.
                    </p>
                </div>

                {/* Collapsible API config */}
                <div className="config-section">
                    <button
                        type="button"
                        className="config-toggle"
                        onClick={() => setShowConfig(!showConfig)}
                    >
                        <Settings size={14} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> Configuração da API {showConfig ? '▲' : '▼'}
                        {isConfigured && !showConfig && <span className="config-status">✓ Configurado</span>}
                    </button>

                    {showConfig && (
                        <form onSubmit={handleSaveConfig} className="config-form">
                            <p className="config-hint">
                                Insira as credenciais do seu aplicativo Bling (obtidas no painel de desenvolvedor).
                            </p>
                            <div className="field">
                                <label htmlFor="clientId">Client ID</label>
                                <input
                                    id="clientId"
                                    type="text"
                                    value={clientId}
                                    onChange={(e) => setClientId(e.target.value)}
                                    placeholder="Cole seu Client ID aqui"
                                    autoComplete="off"
                                    required
                                />
                            </div>

                            <div className="field">
                                <label htmlFor="clientSecret">Client Secret</label>
                                <div className="input-with-toggle">
                                    <input
                                        id="clientSecret"
                                        type={showSecret ? 'text' : 'password'}
                                        value={clientSecret}
                                        onChange={(e) => setClientSecret(e.target.value)}
                                        placeholder="Cole seu Client Secret aqui"
                                        autoComplete="off"
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="toggle-visibility"
                                        onClick={() => setShowSecret(!showSecret)}
                                        title={showSecret ? 'Ocultar' : 'Mostrar'}
                                    >
                                        {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>

                            <button type="submit" className="btn btn-secondary btn-block">
                                Salvar Configuração
                            </button>
                        </form>
                    )}
                </div>

                {/* Demo mode */}
                <div className="demo-section">
                    <button type="button" className="btn-demo" onClick={onDemoMode}>
                        <Monitor size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Explorar sem login (demonstração)
                    </button>
                </div>
            </div>
        </div>
    );
}
