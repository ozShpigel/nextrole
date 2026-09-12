using MongoDB.Bson;
using MongoDB.Driver;

// Copies a MongoDB database — documents AND index definitions — to a new name.
//
// Exists to make the multi-user migration rehearsable against real data before
// it runs for real (deploy/README.md). The index definitions are the point:
// the migration drops and rebuilds the legacy unique indexes and the retention
// TTL, so a document-only copy silently skips half of what is being rehearsed.
//
//   MongoDB__ConnectionString="<uri>" dotnet run --project server/api/src/DbCopy -- \
//       job-tracker=job-tracker-rehearsal jobmatch=jobmatch-rehearsal
//
// Read-only on every source. Refuses to write into a database that already
// exists — a "scratch" name that turns out to be real is how live data gets
// clobbered, and the tool should not be the thing that assumes.

const int BatchSize = 500;

var connectionString =
    Environment.GetEnvironmentVariable("MongoDB__ConnectionString")
    ?? Environment.GetEnvironmentVariable("MongoDB:ConnectionString")
    ?? "";

if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine("MongoDB__ConnectionString is required.");
    return 1;
}

var pairs = new List<(string Source, string Target)>();
var force = false;
foreach (var arg in args)
{
    if (arg is "--force")
    {
        force = true;
        continue;
    }
    var parts = arg.Split('=', 2);
    if (parts.Length != 2 || parts.Any(string.IsNullOrWhiteSpace))
    {
        Console.Error.WriteLine($"Expected source=target, got '{arg}'.");
        return 1;
    }
    pairs.Add((parts[0], parts[1]));
}

if (pairs.Count == 0)
{
    Console.Error.WriteLine(
        "Usage: dotnet run --project server/api/src/DbCopy -- <source>=<target> [<source>=<target> ...] [--force]");
    return 1;
}

var client = new MongoClient(connectionString);
var host = new MongoUrl(connectionString).Server?.Host ?? "(unknown host)";
var existing = (await (await client.ListDatabaseNamesAsync()).ToListAsync()).ToHashSet(StringComparer.Ordinal);
Console.WriteLine($"Copying on host={host}");

foreach (var (source, target) in pairs)
{
    if (!existing.Contains(source))
    {
        Console.Error.WriteLine($"Source database '{source}' does not exist.");
        return 1;
    }
    if (existing.Contains(target) && !force)
    {
        Console.Error.WriteLine(
            $"Target database '{target}' already exists. Pick an unused name, or pass --force to add to it " +
            "(which will mix this copy into whatever is already there).");
        return 1;
    }
    if (source == target)
    {
        Console.Error.WriteLine($"Source and target are the same database ('{source}').");
        return 1;
    }
}

foreach (var (source, target) in pairs)
{
    Console.WriteLine($"{source} -> {target}");
    var src = client.GetDatabase(source);
    var dst = client.GetDatabase(target);

    var collections = (await (await src.ListCollectionNamesAsync()).ToListAsync())
        .OrderBy(n => n, StringComparer.Ordinal);

    foreach (var name in collections)
    {
        var from = src.GetCollection<BsonDocument>(name);
        var to = dst.GetCollection<BsonDocument>(name);

        var copied = 0;
        var buffer = new List<BsonDocument>(BatchSize);
        using (var cursor = await from.FindAsync(FilterDefinition<BsonDocument>.Empty))
        {
            while (await cursor.MoveNextAsync())
            {
                foreach (var doc in cursor.Current)
                {
                    buffer.Add(doc);
                    if (buffer.Count < BatchSize) continue;
                    await to.InsertManyAsync(buffer);
                    copied += buffer.Count;
                    buffer.Clear();
                }
            }
        }
        if (buffer.Count > 0)
        {
            await to.InsertManyAsync(buffer);
            copied += buffer.Count;
        }
        // An empty source collection still has to exist on the target: its
        // indexes are part of what is being rehearsed.
        if (copied == 0) await dst.CreateCollectionAsync(name);

        var rebuilt = await CopyIndexesAsync(from, to);
        Console.WriteLine($"   {name,-24} {copied,6} docs, indexes: {(rebuilt.Count > 0 ? string.Join(", ", rebuilt) : "-")}");
    }
}

Console.WriteLine("Copy complete. Drop these when the rehearsal is done — a full copy of "
                  + "production roughly doubles cluster storage.");
return 0;

// Replays each index definition verbatim rather than reconstructing it from
// known field names: this tool has no schema knowledge, so whatever the source
// has (unique, collation, partial filters, TTL expiry) is what the target gets.
static async Task<List<string>> CopyIndexesAsync(
    IMongoCollection<BsonDocument> from, IMongoCollection<BsonDocument> to)
{
    var rebuilt = new List<string>();
    var indexes = await (await from.Indexes.ListAsync()).ToListAsync();

    foreach (var index in indexes)
    {
        var name = index.GetValue("name", "").AsString;
        // _id_ is created automatically and cannot be re-declared.
        if (name is "" or "_id_") continue;

        var keys = index["key"].AsBsonDocument;
        var options = new CreateIndexOptions<BsonDocument> { Name = name };

        if (index.TryGetValue("unique", out var unique) && unique.ToBoolean())
            options.Unique = true;
        if (index.TryGetValue("sparse", out var sparse) && sparse.ToBoolean())
            options.Sparse = true;
        if (index.TryGetValue("expireAfterSeconds", out var expiry))
            options.ExpireAfter = TimeSpan.FromSeconds(expiry.ToDouble());
        if (index.TryGetValue("partialFilterExpression", out var partial))
            options.PartialFilterExpression = partial.AsBsonDocument;
        if (index.TryGetValue("collation", out var collation))
            options.Collation = ParseCollation(collation.AsBsonDocument);

        await to.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(keys, options));
        rebuilt.Add(name);
    }
    return rebuilt;
}

// The server echoes a `version` back on a collation that CreateIndex will not
// accept, so the fields are read across explicitly rather than round-tripped.
static Collation ParseCollation(BsonDocument c) => new(
    locale: c.GetValue("locale", "simple").AsString,
    caseLevel: c.TryGetValue("caseLevel", out var cl) ? cl.ToBoolean() : null,
    caseFirst: c.TryGetValue("caseFirst", out var cf) ? new CollationCaseFirst?(ToCaseFirst(cf.AsString)) : null,
    strength: c.TryGetValue("strength", out var s) ? new CollationStrength?((CollationStrength)s.ToInt32()) : null,
    numericOrdering: c.TryGetValue("numericOrdering", out var no) ? no.ToBoolean() : null,
    alternate: c.TryGetValue("alternate", out var a) ? new CollationAlternate?(ToAlternate(a.AsString)) : null,
    maxVariable: c.TryGetValue("maxVariable", out var mv) ? new CollationMaxVariable?(ToMaxVariable(mv.AsString)) : null,
    normalization: c.TryGetValue("normalization", out var n) ? n.ToBoolean() : null,
    backwards: c.TryGetValue("backwards", out var b) ? b.ToBoolean() : null);

static CollationCaseFirst ToCaseFirst(string v) => v switch
{
    "upper" => CollationCaseFirst.Upper,
    "lower" => CollationCaseFirst.Lower,
    _ => CollationCaseFirst.Off,
};

static CollationAlternate ToAlternate(string v) =>
    v == "shifted" ? CollationAlternate.Shifted : CollationAlternate.NonIgnorable;

static CollationMaxVariable ToMaxVariable(string v) =>
    v == "space" ? CollationMaxVariable.Space : CollationMaxVariable.Punctuation;
