// Fill pool_functions and pool_locations from existing profiles (docs/greenhouse.md -> The pre-read filter).
// Idempotent: re-running rebuilds both from what profiles say now.
// DB names come from the API's own env file (.env.api), resolved exactly as the API does:
//   main DB     -- MongoDB:DatabaseName ?? "job-tracker"                       (MongoExtensions)
//   profile DB  -- MongoDB:ProfileDatabase ?? MongoDB:Database ?? "jobmatch"   (MongoProfileProvider)
const MAIN_DB = process.env.MongoDB__DatabaseName || "job-tracker";
const PROFILE_DB = process.env.MongoDB__ProfileDatabase || process.env.MongoDB__Database || "jobmatch";
print(`profiles from ${PROFILE_DB}.profile -> ${MAIN_DB}.pool_functions + pool_locations`);

// Mirrors PoolDemand.LocationTermsOf: comma segments, lower-cased, 2-60 chars with a letter, first 4.
const locationTerms = loc => !loc ? [] : [...new Set(loc.split(",").map(s => s.trim().toLowerCase())
  .filter(s => s.length > 1 && s.length <= 60 && /\p{L}/u.test(s)))].slice(0, 4);

const functions = {}, locations = {};
const add = (map, key, user) => (map[key] ??= new Set()).add(user);
db.getSiblingDB(PROFILE_DB).profile.find({}, { "profile_structured.functions": 1, "profile_structured.location": 1 })
  .forEach(p => {
    (p.profile_structured?.functions || []).forEach(f => add(functions, f, p._id));
    locationTerms(p.profile_structured?.location).forEach(l => add(locations, l, p._id));
  });

const write = (coll, map) => {
  const c = db.getSiblingDB(MAIN_DB).getCollection(coll);
  const keys = Object.keys(map);
  keys.forEach(k => c.replaceOne({ _id: k }, { _id: k, UserIds: [...map[k]], UpdatedAt: new Date() }, { upsert: true }));
  c.deleteMany({ _id: { $nin: keys } });
  c.find().forEach(d => print(`  ${coll}: ${d._id} -- ${d.UserIds.length} user(s)`));
};
write("pool_functions", functions);
write("pool_locations", locations);
