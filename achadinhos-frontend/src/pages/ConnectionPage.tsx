import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Smartphone, Power, Webhook, CheckCircle2, AlertTriangle } from 'lucide-react'
import { connectionApi, apiErrorMessage, type ConnectionState } from '@/lib/api'
import { Button, Card, Badge, Spinner, Input, Label } from '@/components/ui'

function statusBadge(status: ConnectionState['status']) {
  switch (status) {
    case 'CONNECTED':
      return <Badge tone="green">Conectado</Badge>
    case 'WAITING_QR':
      return <Badge tone="amber">Aguardando leitura do QR</Badge>
    case 'WAITING_PHONE_CODE':
      return <Badge tone="amber">Aguardando código</Badge>
    default:
      return <Badge tone="zinc">Desconectado</Badge>
  }
}

function WebhookPanel() {
  const qc = useQueryClient()
  const infoQuery = useQuery({
    queryKey: ['connection-webhook'],
    queryFn: connectionApi.webhookInfo,
  })
  const updateMutation = useMutation({
    mutationFn: connectionApi.updateWebhook,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connection-webhook'] }),
  })

  const info = infoQuery.data

  return (
    <Card className="mt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Webhook size={18} className="text-violet-600" />
          <h2 className="font-semibold">Webhook</h2>
          {info &&
            (info.matches ? (
              <Badge tone="green">
                <CheckCircle2 size={12} className="mr-1 inline" />
                Sincronizado
              </Badge>
            ) : (
              <Badge tone="amber">
                <AlertTriangle size={12} className="mr-1 inline" />
                Precisa atualizar
              </Badge>
            ))}
        </div>
        <Button variant="ghost" onClick={() => infoQuery.refetch()} disabled={infoQuery.isFetching}>
          <RefreshCw size={16} /> Verificar
        </Button>
      </div>

      {infoQuery.isLoading && <Spinner />}

      {infoQuery.isError && <p className="text-sm text-red-600">{apiErrorMessage(infoQuery.error)}</p>}

      {info && (
        <div className="space-y-2 text-sm">
          {!info.apiBaseUrlConfigured && (
            <div className="rounded-lg bg-amber-50 p-3 text-amber-800">
              <AlertTriangle size={14} className="mr-1 inline" />
              <strong>API_BASE_URL não configurada</strong> no servidor. Defina a URL pública (ex.:
              seu túnel ngrok) na variável <code>API_BASE_URL</code> do <code>.env</code> do backend
              e reinicie. Depois clique em "Atualizar webhook".
            </div>
          )}
          <div>
            <span className="text-zinc-500">Configurado na instância: </span>
            <code className="break-all text-xs">{info.configuredUrl ?? '— nenhum —'}</code>
          </div>
          <div>
            <span className="text-zinc-500">Esperado (API_BASE_URL): </span>
            <code className="break-all text-xs">{info.expectedUrl ?? '— indefinido —'}</code>
          </div>

          {updateMutation.isError && (
            <p className="text-red-600">{apiErrorMessage(updateMutation.error)}</p>
          )}
          {updateMutation.isSuccess && (
            <p className="text-green-600">Webhook atualizado para {updateMutation.data.url}</p>
          )}

          <Button
            className="mt-2"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !info.apiBaseUrlConfigured}
          >
            <Webhook size={16} />
            {updateMutation.isPending ? 'Atualizando…' : 'Atualizar webhook'}
          </Button>
        </div>
      )}
    </Card>
  )
}

export default function ConnectionPage() {
  const qc = useQueryClient()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [usePairing, setUsePairing] = useState(false)
  const [phone, setPhone] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://free.uazapi.com')
  const [instanceToken, setInstanceToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['connection'],
    queryFn: connectionApi.status,
    // Poll while waiting so the QR scan / connection is reflected quickly.
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'WAITING_QR' || s === 'WAITING_PHONE_CODE' ? 3000 : false
    },
  })

  const connectMutation = useMutation({
    mutationFn: () => connectionApi.connect(usePairing && phone ? phone : undefined),
    onSuccess: (data) => {
      qc.setQueryData(['connection'], data)
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const disconnectMutation = useMutation({
    mutationFn: connectionApi.disconnect,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connection'] }),
  })

  const attachMutation = useMutation({
    mutationFn: () =>
      connectionApi.attachExisting({ baseUrl: baseUrl.trim(), instanceToken: instanceToken.trim() }),
    onSuccess: (data) => {
      qc.setQueryData(['connection'], data)
      setError(null)
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const state = statusQuery.data
  const connected = state?.status === 'CONNECTED'

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Smartphone className="text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold">Conexão do WhatsApp</h1>
          <p className="text-sm text-zinc-500">
            Conecte o número que enviará as ofertas. Um número por usuário.
          </p>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-700">Status:</span>
            {statusQuery.isLoading ? <Spinner /> : statusBadge(state?.status ?? 'DISCONNECTED')}
          </div>
          <Button variant="ghost" onClick={() => statusQuery.refetch()}>
            <RefreshCw size={16} /> Atualizar
          </Button>
        </div>

        {connected && (
          <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
            Número conectado{state?.phoneNumber ? `: ${state.phoneNumber}` : ''}. Você já pode
            listar grupos e enviar ofertas.
            <div className="mt-3">
              <Button
                variant="danger"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <Power size={16} /> Desconectar
              </Button>
            </div>
          </div>
        )}

        {!connected && (
          <div className="space-y-4">
            {/* Mode: provision a new instance (QR) OR attach an existing one. */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setMode('new')}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  mode === 'new'
                    ? 'border-violet-500 bg-violet-50 text-violet-700'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                Novo número (QR)
              </button>
              <button
                onClick={() => setMode('existing')}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  mode === 'existing'
                    ? 'border-violet-500 bg-violet-50 text-violet-700'
                    : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                Instância existente
              </button>
            </div>

            {mode === 'existing' ? (
              <div className="space-y-3">
                <p className="text-sm text-zinc-500">
                  Já tem uma instância UAZAPI com um número conectado? Informe a URL do servidor e o
                  token da instância para conectar direto — sem QR.
                </p>
                <div>
                  <Label>Servidor UAZAPI (Base URL)</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://free.uazapi.com"
                  />
                </div>
                <div>
                  <Label>Token da instância</Label>
                  <Input
                    type="password"
                    value={instanceToken}
                    onChange={(e) => setInstanceToken(e.target.value)}
                    placeholder="cole o token da instância aqui"
                    autoComplete="off"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button
                  onClick={() => attachMutation.mutate()}
                  disabled={attachMutation.isPending || !baseUrl.trim() || instanceToken.trim().length < 8}
                >
                  {attachMutation.isPending ? 'Conectando…' : 'Conectar instância'}
                </Button>
              </div>
            ) : (
              <>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!usePairing}
                  onChange={() => setUsePairing(false)}
                />
                QR Code
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={usePairing} onChange={() => setUsePairing(true)} />
                Código por telefone
              </label>
            </div>

            {usePairing && (
              <div>
                <Label>Número (com DDI, só dígitos)</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="5511999999999"
                />
              </div>
            )}

            {state?.qrCode && !usePairing && (
              <div className="flex flex-col items-center gap-2">
                <img
                  src={state.qrCode}
                  alt="QR Code"
                  className="h-56 w-56 rounded-lg border border-zinc-200"
                />
                <p className="text-xs text-zinc-500">
                  Abra o WhatsApp → Aparelhos conectados → Conectar aparelho
                </p>
              </div>
            )}

            {state?.pairingCode && usePairing && (
              <div className="rounded-lg bg-violet-50 p-4 text-center">
                <p className="text-sm text-zinc-600">Digite este código no WhatsApp:</p>
                <p className="text-2xl font-bold tracking-widest text-violet-700">
                  {state.pairingCode}
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending || (usePairing && phone.length < 10)}
            >
              {connectMutation.isPending ? 'Gerando…' : state?.qrCode ? 'Gerar novo QR' : 'Conectar'}
            </Button>
              </>
            )}
          </div>
        )}
      </Card>

      {state && state.id > 0 && <WebhookPanel />}
    </div>
  )
}
