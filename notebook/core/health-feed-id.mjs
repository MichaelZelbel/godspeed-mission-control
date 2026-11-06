// The one owner of the id a day's health measurement is kept under, whoever wrote it: the phone's
// receiver (phone-health.mjs) and the selected CSV import (personal-operations.mjs). A correction from
// either feed replaces the day's record only because both build the id here.
import {hash} from './records/store.mjs';
export const healthFeedId=(source,day,metric)=>'health-feed-'+hash([source,day,metric]);
// The phone receiver's rows have ids of their own inside the same scheme, so a CSV that carries the app's name keeps
// its own row and its own value; the reader picks between the two by who wrote them (health-inputs.mjs).
export const phoneFeedId=(source,day,metric)=>healthFeedId(source+' (phone)',day,metric);
