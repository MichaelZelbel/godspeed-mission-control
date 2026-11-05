// The two operations of Settings > Health data from your phone, and the states they answer with. The
// server (server/main.mjs) answers them; the panel (ui/src/local/PhoneHealth.tsx) calls them by the
// same routes and reads the same states; test/phone-health.test.mjs checks that the panel's routes and
// state fields are these. A server install answers {available:true,address} (the private address,
// null until the server has an https web address); a computer answers {available:false}.
export const PHONE_HEALTH_STATUS='phone-health';
export const PHONE_HEALTH_RENEW='phone-health/renew';
export const PHONE_HEALTH_FIELDS=['available','address'];
