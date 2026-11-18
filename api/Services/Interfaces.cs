using BackdropAds.Api.Domain;

namespace BackdropAds.Api.Services;

/// <summary>Identifies the current user (resolved from the JWT by <see cref="UserContext"/>).</summary>
public interface IUserContext
{
    string UserId { get; }

    /// <summary>Current workspace: the X-Workspace-Id header when it belongs to the user, else their first workspace.</summary>
    string WorkspaceId { get; }
}

/// <summary>Produces the concepts for a generation. Mocked until real AI generation lands.</summary>
public interface IAdGenerationService
{
    /// <summary>Deterministically builds 3-4 concepts for the generation (stable per generation id).</summary>
    List<Concept> GenerateConcepts(Generation generation);
}

/// <summary>Analyzes a creative and produces the roast. Mocked until real AI analysis lands.</summary>
public interface IAdAnalysisService
{
    /// <summary>Deterministically fills in scores, roast text, recommendations and improved copy (stable per roast id).</summary>
    void CompleteRoast(Roast roast);
}

/// <summary>Turns a completed roast into a new, improved generation request. Mocked until real AI lands.</summary>
public interface IAdImprovementService
{
    /// <summary>
    /// Builds a new processing Generation whose brief is prefilled from the roast's
    /// recommendations and improved copy, with roastId set. Picks a placement that is
    /// valid for the roast's platform per the combination matrix (falling back to a
    /// creative type the platform supports when the requested one is not available).
    /// </summary>
    Generation BuildImprovedGeneration(Roast roast, CreativeType? requestedCreativeType, Ad? sourceAd);
}
