using System.Reflection;
using System.Text.RegularExpressions;
using ApplicationTracker.Infrastructure.Repositories;
using MongoDB.Driver;

namespace ArchitectureTests;

/// <summary>
/// <see cref="UserScopedCollection{T}"/> must stay a one-way door: a caller can
/// query through it, and cannot get the raw collection back out to query around it.
/// </summary>
/// <remarks>
/// This started as an allowlist test for a <c>.Unscoped</c> escape hatch. Writing
/// it showed the hatch had no callers at all — index creation and the migration
/// take their own <c>IMongoCollection&lt;T&gt;</c> from DI — so the hatch was
/// removed and the rule became structural instead of conventional. What is left
/// to guard is its reintroduction, from either direction: a member that hands the
/// raw handle out, or source that reaches for one.
///
/// Permitted raw-collection call sites (index creation, migration, registration,
/// the seeder CLI) are asserted by <see cref="RawCollectionAccessTests"/>, which
/// is where the allowlist now lives.
/// </remarks>
public class UserScopingTests
{
    [Fact]
    public void Wrapper_exposes_no_way_to_reach_the_unfiltered_collection()
    {
        var leaks = new List<string>();
        var type = typeof(UserScopedCollection<>);
        const BindingFlags All = BindingFlags.Public | BindingFlags.NonPublic
                               | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        // A public member returning IMongoCollection<T> is the hatch, whatever it
        // gets called — checking the return type rather than the name "Unscoped"
        // means a differently-named reintroduction still fails.
        foreach (var p in type.GetProperties(All).Where(p => p.GetMethod is { IsPublic: true } && IsCollection(p.PropertyType)))
            leaks.Add($"property {p.Name}");
        foreach (var m in type.GetMethods(All).Where(m => m.IsPublic && IsCollection(m.ReturnType)))
            leaks.Add($"method {m.Name}()");
        foreach (var f in type.GetFields(All).Where(f => f.IsPublic && IsCollection(f.FieldType)))
            leaks.Add($"field {f.Name}");

        Assert.True(leaks.Count == 0,
            "UserScopedCollection<T> must not expose the unfiltered collection — every query has to go through "
            + "an overload that takes a userId. Remove: " + string.Join(", ", leaks));

        // Vacuity guard: the search is only meaningful while the wrapper really
        // does hold a raw collection to leak.
        Assert.Contains(type.GetFields(All), f => IsCollection(f.FieldType) && f.IsPrivate);
    }

    [Fact]
    public void No_source_file_references_an_escape_hatch()
    {
        // Belt to the reflection test's braces: catches a hatch added to some
        // other type, or a call left behind by a partial revert.
        var offenders = RepoSources.Matches(new Regex(@"\.Unscoped\b", RegexOptions.Compiled)).ToList();

        Assert.True(offenders.Count == 0,
            "`.Unscoped` was removed: it let a caller query a user-scoped collection without a userId filter. "
            + "Index creation and migration take IMongoCollection<T> from DI instead. Found:"
            + Environment.NewLine + "  "
            + string.Join(Environment.NewLine + "  ", offenders.Select(o => $"{o.File}:{o.Line}  {o.Text}")));
    }

    private static bool IsCollection(Type t) =>
        t.IsGenericType && t.GetGenericTypeDefinition() == typeof(IMongoCollection<>);
}
