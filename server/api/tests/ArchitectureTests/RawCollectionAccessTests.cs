using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using ApplicationTracker.Core.Identity;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Driver;

namespace ArchitectureTests;

/// <summary>
/// The other way out of per-user filtering: never take
/// <see cref="UserScopedCollection{T}"/> at all, and hold a raw
/// <c>IMongoCollection&lt;T&gt;</c> for a user-owned document instead.
/// </summary>
/// <remarks>
/// Blocking <c>.Unscoped</c> alone would not catch this — a new repository that
/// simply asks DI for the raw collection never touches the hatch. Two checks:
/// reflection over what types actually declare (the realistic route, since
/// repositories take their collection through the constructor), and a source
/// scan for the service-locator form reflection cannot see.
///
/// Documents keyed by <c>_id = userId</c> (profile, resumeFile,
/// interviewInsights) are deliberately out of scope: they do not implement
/// <see cref="IUserOwned"/>, because the id IS the scope and there is no
/// unscoped query shape to write.
/// </remarks>
public class RawCollectionAccessTests
{
    private static readonly HashSet<string> TypeAllowlist = new(StringComparer.Ordinal)
    {
        "UserScopedCollection`1",            // wraps the raw handle; that is its job
        "ApplicationIndexInitializer",       // index creation spans users
        "UserScopeMigrationInitializer",     // migration spans users
        "MongoExtensions",                   // the single registration point
    };

    private static readonly HashSet<string> FileAllowlist = new(StringComparer.Ordinal)
    {
        "server/api/src/Api/Program.cs",                                              // resolves them to hand to the initializers
        "server/api/src/Api/Extensions/MongoExtensions.cs",
        "server/api/src/Infrastructure/Repositories/ApplicationIndexInitializer.cs",
        "server/api/src/Infrastructure/Repositories/UserScopedCollection.cs",
        // One-shot CLI, not a request path: it resolves a single seed user up
        // front and stamps every document with it. Nothing here serves a reader.
        "server/api/src/Seeder/Program.cs",
    };

    [Fact]
    public void No_type_depends_on_a_raw_collection_of_user_owned_documents()
    {
        var assemblies = new[]
        {
            typeof(UserScopedCollection<>).Assembly,
            typeof(ApplicationTracker.Api.Extensions.MongoExtensions).Assembly,
            // The models themselves live in Core; without it the IUserOwned scan
            // below finds nothing and the test silently verifies nothing.
            typeof(ApplicationTracker.Core.Models.Application).Assembly,
        };

        // Vacuity guard: if nothing implements IUserOwned any more, this test has
        // stopped meaning anything.
        var ownedTypes = assemblies
            .SelectMany(a => a.GetTypes())
            .Where(t => t is { IsClass: true } && typeof(IUserOwned).IsAssignableFrom(t))
            .ToList();
        Assert.NotEmpty(ownedTypes);

        var offenders = new List<string>();
        foreach (var type in assemblies.SelectMany(a => a.GetTypes()))
        {
            // Async state machines and closures are compiler-generated copies of a
            // method the loop already inspects directly; they are named
            // <EnsureIndexesAsync>d__10, so matching the allowlist on type.Name
            // would miss them and report the same method twice over.
            if (IsCompilerGenerated(type)) continue;
            if (TypeAllowlist.Contains(OutermostName(type))) continue;

            const BindingFlags All = BindingFlags.Public | BindingFlags.NonPublic
                                   | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

            foreach (var field in type.GetFields(All).Where(f => IsRawUserOwnedCollection(f.FieldType)))
                offenders.Add($"{type.FullName}.{field.Name} : {Describe(field.FieldType)}");

            foreach (var ctor in type.GetConstructors(All))
                foreach (var p in ctor.GetParameters().Where(p => IsRawUserOwnedCollection(p.ParameterType)))
                    offenders.Add($"{type.FullName}..ctor({p.Name}) : {Describe(p.ParameterType)}");

            foreach (var method in type.GetMethods(All))
                foreach (var p in method.GetParameters().Where(p => IsRawUserOwnedCollection(p.ParameterType)))
                    offenders.Add($"{type.FullName}.{method.Name}({p.Name}) : {Describe(p.ParameterType)}");
        }

        Assert.True(offenders.Count == 0,
            "These depend on a raw IMongoCollection<T> for a user-owned document, bypassing UserScopedCollection<T> "
            + "and its mandatory userId filter. Take UserScopedCollection<T> instead:"
            + Environment.NewLine + "  " + string.Join(Environment.NewLine + "  ", offenders));
    }

    // Catches the service-locator form (GetRequiredService<IMongoCollection<X>>(),
    // db.GetCollection<X>(...)) that declares nothing for reflection to find.
    [Fact]
    public void No_source_file_reaches_for_a_raw_collection_of_user_owned_documents()
    {
        var owned = string.Join('|', typeof(UserScopedCollection<>).Assembly
            .GetTypes()
            .Concat(typeof(ApplicationTracker.Core.Models.Application).Assembly.GetTypes())
            .Where(t => t is { IsClass: true } && typeof(IUserOwned).IsAssignableFrom(t))
            .Select(t => Regex.Escape(t.Name))
            .Distinct()
            .OrderBy(n => n, StringComparer.Ordinal));
        Assert.NotEqual("", owned);

        var pattern = new Regex($@"(IMongoCollection|GetCollection|GetRequiredService)\s*<\s*(IMongoCollection\s*<\s*)?({owned})\s*>", RegexOptions.Compiled);

        var offenders = RepoSources.Matches(pattern)
            .Where(m => !FileAllowlist.Contains(m.File))
            .ToList();

        var sb = new StringBuilder(
            "These reach for a raw Mongo collection of user-owned documents outside the allowlisted "
            + "index/migration/registration/seeder files. Go through UserScopedCollection<T>:");
        foreach (var (file, line, text) in offenders)
            sb.AppendLine().Append("  ").Append(file).Append(':').Append(line).Append("  ").Append(text);
        Assert.True(offenders.Count == 0, sb.ToString());
    }


    private static bool IsCompilerGenerated(Type type) =>
        type.IsDefined(typeof(System.Runtime.CompilerServices.CompilerGeneratedAttribute), inherit: false)
        || (type.DeclaringType is not null && IsCompilerGenerated(type.DeclaringType));

    // A nested type is governed by whatever the outer type is allowed to do.
    private static string OutermostName(Type type)
    {
        var current = type;
        while (current.DeclaringType is not null) current = current.DeclaringType;
        return current.Name;
    }

    private static bool IsRawUserOwnedCollection(Type type)
    {
        if (!type.IsGenericType || type.GetGenericTypeDefinition() != typeof(IMongoCollection<>)) return false;
        var arg = type.GetGenericArguments()[0];
        // An open generic parameter (MongoExtensions.Register<T>) is not a concrete
        // dependency on a user-owned collection; the allowlist covers that site.
        return !arg.IsGenericParameter && typeof(IUserOwned).IsAssignableFrom(arg);
    }

    private static string Describe(Type type) =>
        $"IMongoCollection<{type.GetGenericArguments()[0].Name}>";
}
