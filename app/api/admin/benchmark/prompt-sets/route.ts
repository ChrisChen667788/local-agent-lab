import { NextResponse } from "next/server";
import {
  createManagedBenchmarkPromptSet,
  deleteManagedBenchmarkPromptSet,
  readManagedBenchmarkPromptSets,
  updateManagedBenchmarkPromptSet
} from "@/lib/agent/benchmark-prompt-set-store";

export const runtime = "nodejs";

type PromptSetBody = {
  id?: string;
  label?: string;
  description?: string;
  prompts?: string[];
};

function normalizePrompts(prompts: unknown) {
  if (!Array.isArray(prompts)) return [];
  return prompts.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function validatePayload(body: PromptSetBody) {
  const label = body.label?.trim() || "";
  const description = body.description?.trim() || "";
  const prompts = normalizePrompts(body.prompts);
  if (!label) return { error: "Prompt set label is required." };
  if (!prompts.length) return { error: "At least one prompt is required." };
  return { label, description, prompts };
}

export async function GET() {
  return NextResponse.json({
    promptSets: readManagedBenchmarkPromptSets()
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PromptSetBody;
    const validated = validatePayload(body);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const promptSet = createManagedBenchmarkPromptSet({
      id: body.id,
      label: validated.label,
      description: validated.description,
      prompts: validated.prompts
    });
    return NextResponse.json({ ok: true, promptSet });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create prompt set." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as PromptSetBody;
    const id = body.id?.trim() || "";
    if (!id) {
      return NextResponse.json({ error: "Prompt set id is required." }, { status: 400 });
    }
    const validated = validatePayload(body);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const promptSet = updateManagedBenchmarkPromptSet(id, validated);
    if (!promptSet) {
      return NextResponse.json({ error: "Prompt set not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, promptSet });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update prompt set." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim() || "";
  if (!id) {
    return NextResponse.json({ error: "Prompt set id is required." }, { status: 400 });
  }
  const deleted = deleteManagedBenchmarkPromptSet(id);
  if (!deleted) {
    return NextResponse.json({ error: "Prompt set not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deletedId: id });
}
