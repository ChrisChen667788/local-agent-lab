import { NextResponse } from "next/server";
import {
  cleanCommunityModelInstallDirectory,
  openCommunityModelInstallDirectory,
  readCommunityModelDiscoverySummary,
  retryCommunityModelInstall,
  scanCommunityModels,
  startCommunityModelInstall,
  verifyCommunityModelInstall
} from "@/lib/community/model-discovery";

export const runtime = "nodejs";

type ModelDiscoveryRequest =
  | {
      action?: "scan";
      query?: string;
    }
  | {
      action: "install";
      candidateId?: string;
    }
  | {
      action: "verify-install";
      jobId?: string;
    }
  | {
      action: "retry-install" | "clean-install-dir" | "open-install-dir";
      jobId?: string;
    };

export async function GET() {
  try {
    const summary = await readCommunityModelDiscoverySummary();
    return NextResponse.json({
      ok: true,
      summary
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load community model summary."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ModelDiscoveryRequest;
    if (body.action === "install") {
      if (!body.candidateId?.trim()) {
        return NextResponse.json({ ok: false, error: "candidateId is required." }, { status: 400 });
      }
      const job = startCommunityModelInstall({ candidateId: body.candidateId.trim() });
      const summary = await readCommunityModelDiscoverySummary();
      return NextResponse.json({
        ok: true,
        job,
        summary
      });
    }

    if (body.action === "verify-install") {
      if (!body.jobId?.trim()) {
        return NextResponse.json({ ok: false, error: "jobId is required." }, { status: 400 });
      }
      const job = await verifyCommunityModelInstall({ jobId: body.jobId.trim() });
      const summary = await readCommunityModelDiscoverySummary();
      return NextResponse.json({
        ok: true,
        job,
        summary
      });
    }

    if (body.action === "retry-install") {
      if (!body.jobId?.trim()) {
        return NextResponse.json({ ok: false, error: "jobId is required." }, { status: 400 });
      }
      const job = retryCommunityModelInstall({ jobId: body.jobId.trim() });
      const summary = await readCommunityModelDiscoverySummary();
      return NextResponse.json({ ok: true, job, summary });
    }

    if (body.action === "clean-install-dir") {
      if (!body.jobId?.trim()) {
        return NextResponse.json({ ok: false, error: "jobId is required." }, { status: 400 });
      }
      const job = await cleanCommunityModelInstallDirectory({ jobId: body.jobId.trim() });
      const summary = await readCommunityModelDiscoverySummary();
      return NextResponse.json({ ok: true, job, summary });
    }

    if (body.action === "open-install-dir") {
      if (!body.jobId?.trim()) {
        return NextResponse.json({ ok: false, error: "jobId is required." }, { status: 400 });
      }
      const opened = openCommunityModelInstallDirectory({ jobId: body.jobId.trim() });
      const summary = await readCommunityModelDiscoverySummary();
      return NextResponse.json({ ok: true, opened, summary });
    }

    const summary = await scanCommunityModels(
      body.action === "scan" || typeof body.action === "undefined" ? body.query : undefined
    );
    return NextResponse.json({
      ok: true,
      summary
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to run community model action."
      },
      { status: 500 }
    );
  }
}
