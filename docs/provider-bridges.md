# Provider bridges

`whatsapp-manager` owns instances, contacts, conversations, campaigns and the
normalized message history. Meta Cloud API is its native and default provider.

Non-native protocols are optional packages named `whatsapp-*`. A bridge only
owns protocol transport and declares a `provider` export in `bridge.js`:

```js
export const provider = {
  id: 'example',
  manifest: { label: 'Example', connection: 'qr', features: { text: true } },
  sendText(instance, recipient, text) {},
};
```

Optional methods are `sendMedia`, `create`, `getQr`, `regenerateQr`,
`disconnect` and `remove`. A bridge that declares `groupManagement: true`
implements `listGroups`, `getGroup`, `createGroup`, `updateGroup`,
`updateGroupParticipants`, `getGroupInviteLink`, `leaveGroup` and
`sendGroupText`. Feature flags must describe methods actually
implemented. The Manager detects bridges safely and does not list one that
cannot load.

Current bridges are `whatsapp-baileys`, `whatsapp-evolution` and
`whatsapp-whatsmeow`. Evolution connects only to an existing external API: it
does not start or manage an Evolution container.

Callers do not select a bridge. The public `whatsapp_send_message` tool accepts
`instanceId`, `number` and `text`, opens or reuses the normalized conversation,
then resolves the transport from the instance provider. `conversationId` is
also accepted for compatibility and for replies in an existing conversation.

## Group protocol

Group operations always receive `instanceId`; the Manager resolves the bridge
from the instance and rejects providers without `groupManagement`. Group IDs
are canonical WhatsApp JIDs ending in `@g.us`. Participant inputs may be E.164
phone numbers or canonical user/LID JIDs. The first complete implementation is
`whatsapp-whatsmeow`.

The public toolset covers listing and inspecting groups, creation, subject and
description changes, participant add/remove/promote/demote, invite-link read or
rotation, leaving, and text sending. Provider-specific payloads do not leak
through this contract. Permission and role failures are returned by the
provider; the protocol does not pretend the connected account is an admin.
