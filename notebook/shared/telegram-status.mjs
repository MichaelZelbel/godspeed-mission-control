export const telegramPhase=Object.freeze({
  none:'none',
  waiting:'waiting',
  settingUp:'setting-up',
  ready:'ready',
  refused:'refused',
  gatewayRouteFailed:'gateway-route-failed',
});
export const telegramPollingPhases=Object.freeze([
  telegramPhase.waiting,
  telegramPhase.settingUp,
  telegramPhase.gatewayRouteFailed,
]);
export const knownTelegramPhase=value=>typeof value==='string'&&Object.values(telegramPhase).includes(value);
