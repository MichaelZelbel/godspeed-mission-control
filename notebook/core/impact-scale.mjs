// Shared by field assistance, connected assistants and the timeline screens.
export const impactLabels = {1:'Everyday',2:'Short-term',3:'Lasting',4:'Life-defining'};
export const impactDescriptions = {
  1:'Records daily activity with negligible impact beyond the activity itself: breakfast, commuting, dishes or starting work.',
  2:'Makes a noticeable difference during the experience or shortly afterward: a movie, an evening out or a frustrating delay.',
  3:'Changes part of your life beyond that day, typically for weeks, months or years: a promotion, a new relationship or a useful skill.',
  4:'Belongs in a brief account of your whole life: birth, graduation, marriage or meeting a long-term partner.',
};
export const impactGuidance = 'Impact is a whole number 1 to 4. '+Object.entries(impactLabels).map(([n,label])=>n+' = '+label+': '+impactDescriptions[n]).join(' ')+' Impact can be positive or negative; rate it separately from emotion. Default mundane activity to 1 (Everyday); never exclude a moment because its impact is negligible. Ratings may change in hindsight.';
export const impactWords = {everyday:1,'short-term':2,lasting:3,'life-defining':4,minor:1,low:1,neutral:2,noticeable:2,medium:2,significant:3,high:3,major:4,'life-changing':4};
