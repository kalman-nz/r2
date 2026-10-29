/// <reference path="../pb_data/types.d.ts" />
// A turned-off feature's records can't be written through the API either
// (lib/features.js guardWrite): its pages are hidden, and this stops the
// collection endpoints underneath them. Reads still work, so turning it back
// on finds everything as it was. The server's own writes (imports, sync,
// deleting an organisation) don't come through here.

const GUARDED = require(`${__hooks}/lib/features.js`).GUARDED_COLLECTIONS;

onRecordCreateRequest((e) => {
  require(`${__hooks}/lib/features.js`).guardWrite(e.app, e.record);
  e.next();
}, ...GUARDED);

onRecordUpdateRequest((e) => {
  require(`${__hooks}/lib/features.js`).guardWrite(e.app, e.record);
  e.next();
}, ...GUARDED);

onRecordDeleteRequest((e) => {
  require(`${__hooks}/lib/features.js`).guardWrite(e.app, e.record);
  e.next();
}, ...GUARDED);
