// The one owner of the id a day's health measurement is kept under, whoever wrote it: the phone's
// receiver (phone-health.mjs) and the selected CSV import (personal-operations.mjs). A correction from
// either feed replaces the day's record only because both build the id here.
import {hash} from './records/store.mjs';
import {PHONE_VIA} from './health-inputs.mjs';
export const healthFeedId=(source,day,metric)=>'health-feed-'+hash([source,day,metric]);
// The phone receiver's rows have ids of their own inside the same scheme: the provenance is a fourth element of what
// is hashed, so no source name a CSV can carry makes a CSV id equal a receiver id. The reader picks between the two by
// who wrote them (health-inputs.mjs).
export const phoneFeedId=(source,day,metric)=>'health-feed-'+hash([PHONE_VIA,source,day,metric]);
