import React, { useState, useEffect, useRef } from 'react';
import { Play, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, Terminal, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LogEntry {
  message: string;
  timestamp: string;
}

export default function App() {
  const [url, setUrl] = useState('https://gpabrqa.service-now.com/');
  const [incidente, setIncidente] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [debug, setDebug] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('Automador: Inicializando EventSource');
    const eventSource = new EventSource('/api/logs');
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (logContainerRef.current) {
          const logLine = document.createElement('div');
          logLine.className = "flex gap-2 border-b border-slate-900/50 pb-0.5 mb-0.5 last:border-0 animate-in fade-in slide-in-from-left-1 duration-300";
          
          const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour12: false });
          const isError = data.message.startsWith('ERRO');
          
          logLine.innerHTML = `
            <span class="text-slate-500 shrink-0">[${timeStr}]</span>
            <span class="break-words ${isError ? 'text-red-400 font-bold' : 'text-blue-300'}">
              ${data.message}
            </span>
          `;
          
          logContainerRef.current.appendChild(logLine);
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      } catch (e) {
        console.error('Erro ao processar log:', e);
      }
    };

    eventSource.onerror = (err) => {
      console.error('EventSource falhou:', err);
    };

    return () => {
      console.log('Automador: Fechando EventSource');
      eventSource.close();
    };
  }, []);

  const handleFinalizar = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    
    // Limpar logs visualmente
    if (logContainerRef.current) {
      logContainerRef.current.innerHTML = '';
    }

    try {
      const response = await fetch('/api/encerrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          incidente,
          justificativa,
          debug,
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ success: false, message: 'Erro ao conectar com o servidor.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans gap-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Play className="w-5 h-5 text-blue-400" />
              Automador ServiceNow
            </h1>
            <p className="text-slate-400 text-sm mt-1">Encerramento automático de incidentes</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
            <div className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`} />
            <span className="text-xs font-medium text-slate-300">{loading ? 'Executando' : 'Pronto'}</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 divide-x divide-slate-100">
          <form onSubmit={handleFinalizar} className="p-6 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="url" className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                URL do ServiceNow
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  id="url"
                  type="url"
                  required
                  className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="incidente" className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                Número do INC
              </label>
              <input
                id="incidente"
                type="text"
                required
                placeholder="Ex: INC009294985"
                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                value={incidente}
                onChange={(e) => setIncidente(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="justificativa" className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                Justificativa Técnica
              </label>
              <textarea
                id="justificativa"
                required
                rows={4}
                placeholder="Descreva a solução aplicada..."
                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm resize-none"
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  id="debug"
                  className="sr-only peer"
                  checked={debug}
                  onChange={(e) => setDebug(e.target.checked)}
                />
                <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </div>
              <label htmlFor="debug" className="text-xs font-semibold text-slate-600 flex items-center gap-2 cursor-pointer">
                {debug ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                Modo Debug (Navegador Visível)
              </label>
            </div>
            {debug && (
              <p className="text-[10px] text-amber-600 font-medium px-1">
                * O navegador abrirá em uma janela separada.
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processando...
                </>
              ) : (
                'Iniciar Automação'
              )}
            </button>
          </form>

          <div className="bg-slate-950 p-4 flex flex-col h-[450px]">
            <div className="flex items-center gap-2 text-slate-400 mb-3 border-b border-slate-800 pb-2">
              <Terminal className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest">Log de Execução</span>
            </div>
            
            <div 
              ref={logContainerRef}
              className="flex-1 overflow-y-auto font-mono text-[11px] space-y-1 custom-scrollbar scroll-smooth"
            >
              {/* Logs serão anexados aqui via DOM API para evitar re-renders */}
            </div>

            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mt-4 p-3 rounded-lg border ${result.success ? 'bg-green-900/20 border-green-800/50 text-green-400' : 'bg-red-900/20 border-red-800/50 text-red-400'}`}
                >
                  <div className="flex items-center gap-2">
                    {result.success ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span className="text-xs font-bold">{result.success ? 'CONCLUÍDO' : 'FALHA'}</span>
                  </div>
                  <p className="text-[10px] mt-1 opacity-80">{result.message}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
