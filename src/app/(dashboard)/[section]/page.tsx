import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { MILESTONES, PLANNED_SECTIONS } from "@/lib/navigation";

// This page resolves `params` before rendering anything, so it opts out of instant
// (streamed-shell) navigation. It is static text; there is nothing to stream.
export const instant = false;

export function generateStaticParams() {
  return PLANNED_SECTIONS.map((section) => ({ section: section.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[section]">): Promise<Metadata> {
  const { section: slug } = await params;
  return { title: PLANNED_SECTIONS.find((section) => section.slug === slug)?.title };
}

/** Honest placeholder for an area that has not been built: what it will show and what it needs. */
export default async function PlannedSectionPage({ params }: PageProps<"/[section]">) {
  const { section: slug } = await params;
  const section = PLANNED_SECTIONS.find((candidate) => candidate.slug === slug);
  if (!section) notFound();
  return (
    <>
      <PageHeader title={section.title} lead={section.summary} />
      <EmptyState title="This area is not built yet">
        <p>
          It is part of milestone {section.milestone} ({MILESTONES[section.milestone]}). Nothing here reads data or takes action today, and no sample figures are shown in its place.
        </p>
        <p className="mt-3">
          <span className="text-bone">What it will read:</span> {section.dataSource}
        </p>
      </EmptyState>
    </>
  );
}
