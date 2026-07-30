using ApplicationTracker.Core.Models;
using ApplicationTracker.Core.Profile;

namespace ApplicationTracker.Infrastructure.Pdf;

public interface IResumePdfRenderer
{
    // Pure layout — no AI call. Renders straight from the persisted pack
    // content each time it's requested, so the template can evolve without
    // regenerating the tailored content.
    byte[] Render(ResumePack pack, StructuredProfile profile);
}
