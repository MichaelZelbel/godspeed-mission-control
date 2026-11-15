import fs from 'node:fs';

export const telegramAPIEndpoints=JSON.parse(fs.readFileSync(new URL('./telegram-api-endpoints.json',import.meta.url),'utf8'));
export const rejectedTelegramAPIEndpoints=[...telegramAPIEndpoints.rejected,...telegramAPIEndpoints.ambiguous_numeric_ipv4.schemes.flatMap(scheme=>telegramAPIEndpoints.ambiguous_numeric_ipv4.hosts.map(host=>`${scheme}://${host}:8081/telegram/`))];
