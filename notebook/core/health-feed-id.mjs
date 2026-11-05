// The one owner of the id a day's health measurement is kept under, whoever wrote it: the phone's
// receiver (phone-health.mjs) and the selected CSV import (personal-operations.mjs). A correction from
// either feed replaces the day's record only because both build the id here.
import {hash} from './records/store.mjs';
export const healthFeedId=(source,day,metric)=>'health-feed-'+hash([source,day,metric]);
