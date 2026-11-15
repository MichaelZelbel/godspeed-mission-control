// Common English and German words: in a question ("What did I note about
// the knee doctor?") they match nearly every note and say nothing.
export const STOPWORDS = new Set(('a an the and or but if of for with that this these those from to in on at by as is are was were be been being have has had do does did done '
  + 'i me my mine you your yours we us our they them their he him his she her it its what which who whom whose when where why how about into over under after before '
  + 'then than there here also only just more most some such very will would could should can may might must not no yes all any each other one two note notes noted '
  + 'der die das den dem des ein eine einer eines einem einen und oder aber wenn mit von für auf aus bei ist sind war waren wird werden nicht auch noch nur sich sie '
  + 'ihr ihre wir uns mein meine meiner dein deine sein seine hat haben hatte dass dann als wie was wer wo wann warum zum zur über unter nach vor durch schon sehr mehr '
  + 'ich du er es man notiz notizen').split(' '));
