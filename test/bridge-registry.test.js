import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeFor, listProviderBridges } from '../core/bridgeRegistry.js';

test('optional protocol bridges expose the manager provider contract', async () => {
  const bridges = await listProviderBridges();
  // Bridges are optional. Validate only those available in the workspace.
  assert.ok(bridges.some((bridge) => bridge.id === 'whatsmeow'));
  const whatsmeow = await bridgeFor('whatsmeow');
  assert.equal(whatsmeow.manifest.features.media, true);
  assert.equal(whatsmeow.manifest.features.groupManagement, true);
  assert.equal(typeof whatsmeow.createGroup, 'function');
  assert.equal(typeof whatsmeow.requestPairingCode, 'undefined');
  assert.equal(whatsmeow.manifest.connection, 'qr');
  const evolution = await bridgeFor('evolution');
  assert.equal(evolution, null);
});
