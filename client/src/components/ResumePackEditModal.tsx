import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ChipInput } from './ChipInput';
import { useUpdatePack } from '../lib/mutations';
import type { ResumePack, TailoredExperienceItem, SkillCategory, SideProjectItem } from '../lib/types';

interface ResumePackEditModalProps {
  appId: string;
  pack: ResumePack;
  onClose: () => void;
}

// Structured field editor over the same shape ResumePack already stores — no
// rich text, matching the plain-textarea/chip-input style the rest of the app
// (Settings page) uses. No AI call: saves straight to the persisted pack via
// PUT, so it never touches Provenance/Violations (those only exist for a real
// generation) and Regenerate still fully overwrites whatever was edited here.
export function ResumePackEditModal({ appId, pack, onClose }: ResumePackEditModalProps) {
  const [summary, setSummary] = useState(pack.tailoredSummary);
  const [experience, setExperience] = useState<TailoredExperienceItem[]>(pack.experience);
  const [skills, setSkills] = useState<SkillCategory[]>(pack.highlightedSkills);
  const [sideProjects, setSideProjects] = useState<SideProjectItem[]>(pack.sideProjects ?? []);

  const updatePack = useUpdatePack();

  function updateExperience(index: number, patch: Partial<TailoredExperienceItem>): void {
    setExperience((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }
  function removeExperience(index: number): void {
    setExperience((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSkillGroup(index: number, patch: Partial<SkillCategory>): void {
    setSkills((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }
  function removeSkillGroup(index: number): void {
    setSkills((prev) => prev.filter((_, i) => i !== index));
  }
  function addSkillGroup(): void {
    setSkills((prev) => [...prev, { category: '', items: [] }]);
  }

  function updateSideProject(index: number, patch: Partial<SideProjectItem>): void {
    setSideProjects((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function removeSideProject(index: number): void {
    setSideProjects((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave(): void {
    updatePack.mutate(
      {
        appId,
        tailoredSummary: summary.trim(),
        experience: experience.map((e) => ({
          ...e,
          title: e.title.trim(),
          company: e.company.trim(),
          dates: e.dates.trim(),
          highlights: e.highlights.map((h) => h.trim()).filter(Boolean),
        })),
        highlightedSkills: skills
          .map((g) => ({ category: g.category.trim(), items: g.items.map((i) => i.trim()).filter(Boolean) }))
          .filter((g) => g.category.length > 0 && g.items.length > 0),
        sideProjects: sideProjects.map((p) => ({ ...p, name: p.name.trim(), description: p.description.trim() })),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit résumé pack</DialogTitle>
          <DialogDescription>
            Manual edits save directly — no AI call. Regenerating later overwrites everything here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pack-summary">Summary</Label>
          <Textarea
            id="pack-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            dir="auto"
            className="min-h-[80px] resize-y"
          />
        </div>

        <div className="flex flex-col gap-4">
          <Label>Experience</Label>
          {experience.map((entry, i) => (
            <div key={i} className="flex flex-col gap-2 border rounded-md p-3">
              <div className="grid grid-cols-3 gap-2">
                <Input value={entry.title} onChange={(e) => updateExperience(i, { title: e.target.value })} placeholder="Title" />
                <Input value={entry.company} onChange={(e) => updateExperience(i, { company: e.target.value })} placeholder="Company" />
                <Input value={entry.dates} onChange={(e) => updateExperience(i, { dates: e.target.value })} placeholder="Dates" />
              </div>
              <Textarea
                value={entry.highlights.join('\n')}
                onChange={(e) => updateExperience(i, { highlights: e.target.value.split('\n') })}
                placeholder="One highlight per line"
                dir="auto"
                className="min-h-[90px] resize-y font-mono text-sm"
              />
              <Button type="button" variant="ghost" size="sm" className="self-end text-destructive hover:text-destructive" onClick={() => removeExperience(i)}>
                <Trash2 size={14} /> Remove entry
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Label>Skills</Label>
            <Button type="button" variant="outline" size="sm" onClick={addSkillGroup}>
              <Plus size={14} /> Add category
            </Button>
          </div>
          {skills.map((group, i) => (
            <div key={i} className="flex flex-col gap-2 border rounded-md p-3">
              <div className="flex items-center gap-2">
                <Input value={group.category} onChange={(e) => updateSkillGroup(i, { category: e.target.value })} placeholder="Category name" className="flex-1" />
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeSkillGroup(i)}>
                  <Trash2 size={14} />
                </Button>
              </div>
              <ChipInput value={group.items} onChange={(items) => updateSkillGroup(i, { items })} placeholder="Add a skill…" />
            </div>
          ))}
        </div>

        {sideProjects.length > 0 && (
          <div className="flex flex-col gap-4">
            <Label>Side Projects</Label>
            {sideProjects.map((project, i) => (
              <div key={i} className="flex flex-col gap-2 border rounded-md p-3">
                <Input value={project.name} onChange={(e) => updateSideProject(i, { name: e.target.value })} placeholder="Name" />
                <Textarea
                  value={project.description}
                  onChange={(e) => updateSideProject(i, { description: e.target.value })}
                  placeholder="Description"
                  dir="auto"
                  className="min-h-[70px] resize-y"
                />
                <ChipInput value={project.links} onChange={(links) => updateSideProject(i, { links })} placeholder="Add a link…" splitOnComma={false} />
                <Button type="button" variant="ghost" size="sm" className="self-end text-destructive hover:text-destructive" onClick={() => removeSideProject(i)}>
                  <Trash2 size={14} /> Remove project
                </Button>
              </div>
            ))}
          </div>
        )}

        {updatePack.isError && (
          <p className="text-sm text-destructive">{(updatePack.error as Error).message}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={updatePack.isPending}>
            {updatePack.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
