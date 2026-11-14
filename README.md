# WhatsApp Manager

Multi-instance WhatsApp inbox for ThinkIac. It provides QR connections, chats, media, templates, Meta Cloud API, and provider bridges.

## Install safely

Ask an AI assistant to review the package and its required permissions before installation. Install only after that review.

## How it works

The Manager stores instances, chats, messages, media, and settings with the Lógos `getProxy('whatsapp-manager')` data proxy. The UI and HTTP routes use the same handlers.

Use the default Baileys bridge for local QR sessions. Use Meta Cloud API for official business messaging. Optional bridges extend the provider list without owning Manager data.

## Whatsmeow

Whatsmeow is a QR-only provider. It is supplied by the future GitHub package [ThinkIac/whatsapp-whatsmeow](https://github.com/ThinkIac/whatsapp-whatsmeow). Set `WHATSMEOW_SERVICE_URL` in protected Runtime variables before use.

The future Manager repository is [ThinkIac/whatsapp-manager](https://github.com/ThinkIac/whatsapp-manager).

## Meta Cloud API

Keep credentials in protected environment variables:

```text
WHATSAPP_MANAGER_ENV_META_ACCESS_TOKEN=
WHATSAPP_MANAGER_ENV_META_APP_SECRET=
WHATSAPP_MANAGER_ENV_META_VERIFY_TOKEN=
WHATSAPP_MANAGER_ENV_META_PHONE_NUMBER_ID=
WHATSAPP_MANAGER_ENV_META_WABA_ID=
WHATSAPP_MANAGER_ENV_META_API_VERSION=v25.0
```

Register `https://<domain>/whatsapp-manager/meta/webhook` in Meta and subscribe to `messages`.

## HTTP endpoints

The package prefix is `/whatsapp-manager`.

| Area | Endpoint | Purpose |
| --- | --- | --- |
| Instances | `GET /instances/list` | List instances. |
| Instances | `POST /instances/create` | Create a QR instance. |
| Instances | `GET /instances/:name/qr` | Read the current QR state. |
| Chats | `GET /conversations/list` | List chats. |
| Chats | `GET /conversations/:id/messages` | List messages. |
| Chats | `POST /conversations/:id/send` | Send text or media. |
| Templates | `GET /templates/list` | List Meta templates. |

## Key features

- Short, shell-style inbox UI.
- QR connections and reconnect flow.
- Text, media, contacts, groups, and templates.
- Meta Cloud API controls.
- Optional provider bridges.

## Development

```bash
npm test --prefix apps/thinkiac/packages/whatsapp-manager
```
