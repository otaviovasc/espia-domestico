import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Smartphone, Power, Webhook, CheckCircle2, AlertTriangle } from 'lucide-react'
import { connectionApi, apiErrorMessage, type ConnectionState } from '@/lib/api'
import { Button, Card, Badge, Spinner, Input, Label } from '@/components/ui'
import { ConnectionMessagesDialog } from './ConnectionMessagesDialog'

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Webhook size={18} className="text-accent" />
          <h2 className="font-semibold">Recebimento de mensagens</h2>
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

      {infoQuery.isLoading && <div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner /> Verificando recebimento…</div>}

      {infoQuery.isError && <p role="alert" className="text-sm text-danger">Não foi possível verificar a sincronização. {apiErrorMessage(infoQuery.error)} Use “Verificar” para tentar novamente.</p>}

      {info && (
        <div className="space-y-2 text-sm">
          {!info.apiBaseUrlConfigured && (
            <div className="rounded-lg bg-warning-soft p-3 text-warning">
              <AlertTriangle size={14} className="mr-1 inline" />
              <strong>O endereço de recebimento não foi configurado.</strong> Peça ao responsável pela instalação para configurar o endereço público do serviço antes de sincronizar.
            </div>
          )}
          <p className="text-muted">A sincronização permite acompanhar as novas mensagens dos grupos neste painel.</p>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-muted">Detalhes da integração</summary>
            <div className="mt-2">
              <span className="text-muted">Endereço atual: </span>
              <code className="break-all text-xs">{info.configuredUrl ?? '— nenhum —'}</code>
            </div>
            <div>
              <span className="text-muted">Endereço esperado: </span>
              <code className="break-all text-xs">{info.expectedUrl ?? '— indefinido —'}</code>
            </div>
          </details>
          {updateMutation.isError && (
            <p role="alert" className="text-danger">{apiErrorMessage(updateMutation.error)}</p>
          )}
          {updateMutation.isSuccess && (
            <p role="status" className="text-success">Recebimento de mensagens sincronizado.</p>
          )}

          <Button
            className="mt-2"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !info.apiBaseUrlConfigured}
          >
            <Webhook size={16} />
            {updateMutation.isPending ? 'Sincronizando…' : 'Sincronizar mensagens'}
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
  const [disconnectOpen, setDisconnectOpen] = useState(false)

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
    onSuccess: () => {
      setDisconnectOpen(false)
      qc.invalidateQueries({ queryKey: ['connection'] })
    },
  })

  const attachMutation = useMutation({
    mutationFn: () =>
      connectionApi.attachExisting({ baseUrl: baseUrl.trim(), instanceToken: instanceToken.trim() }),
    onSuccess: (data) => {
      qc.setQueryData(['connection'], data)
      setError(null)
      setInstanceToken('')
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  const state = statusQuery.data
  const connected = state?.status === 'CONNECTED'

  return (
    <div className="workspace-page mx-auto max-w-3xl text-ink">
      <div className="page-header">
        <div className="flex items-center gap-3">
        <Smartphone className="hidden text-accent sm:block" aria-hidden="true" />
        <div>
          <h1 className="page-title">Conexão do WhatsApp</h1>
          <p className="text-sm text-muted">
            Conecte o número que enviará as ofertas. Um número por usuário.
          </p>
        </div>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-ink">Status:</span>
            {statusQuery.isLoading ? <span role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner /> Verificando conexão…</span> : statusQuery.isError && !state ? <Badge tone="red">Não foi possível verificar</Badge> : statusBadge(state?.status ?? 'DISCONNECTED')}
          </div>
          <Button variant="ghost" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
            <RefreshCw size={16} /> Atualizar
          </Button>
        </div>

        {statusQuery.isError && <div role="alert" className="mb-4 rounded-lg bg-danger-soft p-3 text-sm text-danger">Não foi possível atualizar a conexão. {apiErrorMessage(statusQuery.error)} Use “Atualizar” para tentar novamente.</div>}

        {connected && (
          <div className="rounded-lg bg-success-soft p-4 text-sm text-success">
            Número conectado{state?.phoneNumber ? `: ${state.phoneNumber}` : ''}. Você já pode
            listar grupos e enviar ofertas.
            <div className="mt-3">
              <Button
                variant="danger"
                onClick={() => { disconnectMutation.reset(); setDisconnectOpen(true) }}
                disabled={disconnectMutation.isPending}
              >
                <Power size={16} /> Desconectar
              </Button>
            </div>
          </div>
        )}

        {!statusQuery.isLoading && state && !connected && (
          <div className="space-y-4">
            {/* Mode: provision a new instance (QR) OR attach an existing one. */}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={connectMutation.isPending || attachMutation.isPending}
                aria-pressed={mode === 'new'}
                onClick={() => { setMode('new'); setError(null) }}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  mode === 'new'
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted hover:bg-surface-muted'
                }`}
              >
                Novo número (QR)
              </button>
              <button
                disabled={connectMutation.isPending || attachMutation.isPending}
                aria-pressed={mode === 'existing'}
                onClick={() => { setMode('existing'); setError(null) }}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  mode === 'existing'
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted hover:bg-surface-muted'
                }`}
              >
                Instância existente
              </button>
            </div>

            {mode === 'existing' ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Já tem uma instância UAZAPI com um número conectado? Informe a URL do servidor e o
                  token da instância para conectar direto — sem QR.
                </p>
                <div>
                  <Label htmlFor="connection-server">Servidor UAZAPI (Base URL)</Label>
                  <Input
                    id="connection-server"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://free.uazapi.com"
                  />
                </div>
                <div>
                  <Label htmlFor="connection-token">Token da instância</Label>
                  <Input
                    id="connection-token"
                    type="password"
                    value={instanceToken}
                    onChange={(e) => setInstanceToken(e.target.value)}
                    placeholder="cole o token da instância aqui"
                    autoComplete="off"
                  />
                </div>
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <Button
                  onClick={() => attachMutation.mutate()}
                  disabled={attachMutation.isPending || connectMutation.isPending || !baseUrl.trim() || instanceToken.trim().length < 8}
                >
                  {attachMutation.isPending ? 'Conectando…' : 'Conectar instância'}
                </Button>
              </div>
            ) : (
              <>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  name="connection-method"
                  type="radio"
                  checked={!usePairing}
                  onChange={() => setUsePairing(false)}
                />
                QR Code
              </label>
              <label className="flex items-center gap-2">
                <input name="connection-method" type="radio" checked={usePairing} onChange={() => setUsePairing(true)} />
                Código por telefone
              </label>
            </div>

            {usePairing && (
              <div>
                <Label htmlFor="connection-phone">Número (com DDI, só dígitos)</Label>
                <Input
                  id="connection-phone"
                  inputMode="tel"
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
                  alt="QR Code para conectar este número ao WhatsApp"
                  className="h-56 w-56 rounded-lg border border-line bg-white p-2"
                />
                <p className="text-xs text-muted">
                  Abra o WhatsApp → Aparelhos conectados → Conectar aparelho
                </p>
              </div>
            )}

            {state?.pairingCode && usePairing && (
              <div className="rounded-lg bg-accent-soft p-4 text-center">
                <p className="text-sm text-muted">Digite este código no WhatsApp:</p>
                <p className="text-2xl font-bold tracking-widest text-accent">
                  {state.pairingCode}
                </p>
              </div>
            )}

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}

            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending || attachMutation.isPending || (usePairing && phone.length < 10)}
            >
              {connectMutation.isPending ? 'Gerando…' : state?.qrCode ? 'Gerar novo QR' : 'Conectar'}
            </Button>
              </>
            )}
          </div>
        )}
      </Card>

      {state && state.id > 0 && <WebhookPanel />}
      {disconnectOpen && (
        <ConnectionMessagesDialog title="Desconectar WhatsApp?" titleId="disconnect-title" onClose={() => setDisconnectOpen(false)}>
          <p className="text-sm text-muted">O número deixará de enviar e receber mensagens por aqui. Campanhas ativas que usam esta conexão podem ter envios interrompidos ou falhar até você conectar novamente.</p>
          <p className="mt-3 text-sm text-muted">Confira as campanhas ativas antes de continuar. Esta ação não pausa as campanhas automaticamente.</p>
          {disconnectMutation.isError && <p role="alert" className="mt-3 text-sm text-danger">{apiErrorMessage(disconnectMutation.error)}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDisconnectOpen(false)}>Manter conectado</Button>
            <Button variant="danger" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}><Power size={16} />{disconnectMutation.isPending ? 'Desconectando…' : 'Desconectar WhatsApp'}</Button>
          </div>
        </ConnectionMessagesDialog>
      )}
    </div>
  )
}
