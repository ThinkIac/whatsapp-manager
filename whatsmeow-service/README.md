# Whatsmeow sidecar

This local `whatsmeow` provider adapter must listen only on `127.0.0.1`. Set
`WHATSMEOW_SERVICE_TOKEN` and use a private `WHATSMEOW_DATA_DIR`. SQLite sessions
contain device credentials: never expose, sync, or commit them.

The Manager uses `WHATSMEOW_SERVICE_URL` (default `http://127.0.0.1:8765`). Pin a
real whatsmeow revision in `go.mod`, run `go mod tidy` and `go test ./...`, then
start the binary under the Runtime supervisor. Set `WHATSMEOW_WEBHOOK_URL` and the
same `WHATSMEOW_WEBHOOK_TOKEN` in the sidecar and Manager environment.

Whatsmeow supports QR connection only.

O sidecar também implementa o transporte do protocolo universal de grupos em
`/instances/:name/groups`: lista, detalhe, criação, nome/descrição,
participantes, link de convite e saída. Texto para grupo usa o endpoint normal
de mensagens com um JID `@g.us`. Alterações administrativas continuam sujeitas
às permissões que a conta conectada possui no próprio WhatsApp.
