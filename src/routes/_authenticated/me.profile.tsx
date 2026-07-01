import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db, storage } from "@/integrations/firebase/client";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { uploadToBlob } from "@/lib/upload";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { claimUsername } from "@/lib/username";
import { reverseGeocode } from "@/lib/geo.server";
import { SiteNav } from "@/components/site-nav";
import { ArrowLeft, Loader2, Upload, Plus, Trash2, GripVertical, FileText, MapPin, ImagePlus, AtSign } from "lucide-react";
import { toast } from "sonner";
import React, { useState, useEffect } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

export const Route = createFileRoute("/_authenticated/me/profile")({
  component: EditProfilePage,
});

function EditProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const geocodeFn = useServerFn(reverseGeocode);
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  
  // New profile fields
  const [resumeUrl, setResumeUrl] = useState("");
  const [resumeFilename, setResumeFilename] = useState("");
  const [uploadingResume, setUploadingResume] = useState(false);
  
  const [links, setLinks] = useState<{ id: string; label: string; url: string }[]>([]);
  const [certificates, setCertificates] = useState<{ id: string; name: string; issuer: string; image?: string }[]>([]);
  const [awards, setAwards] = useState<{ id: string; title: string; description: string; image?: string }[]>([]);
  const [education, setEducation] = useState<{ id: string; institution: string; degree: string; field: string; start_year: string; end_year: string; certificate?: string }[]>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});

  // Location (optional) — powers location-aware job ranking in the feed.
  const [location, setLocation] = useState("");
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [detecting, setDetecting] = useState(false);

  // Public profile handle (crux.app/<username>)
  const [username, setUsername] = useState("");
  const [origUsername, setOrigUsername] = useState("");

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const docSnap = await getDoc(doc(db, "profiles", user!.id));
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } as any : null;
    },
  });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setHeadline(profile.headline || "");
      setBio(profile.bio || "");
      setAvatarUrl(profile.avatar_url || "");
      setResumeUrl(profile.resume_url || "");
      setResumeFilename(profile.resume_filename || "");
      setLinks(profile.links || []);
      setCertificates(profile.certificates || []);
      setAwards(profile.awards || []);
      setEducation(profile.education || []);
      setVisibility(profile.visibility || {});
      setLocation(profile.location || "");
      setGeo(profile.geo || null);
      setUsername(profile.username || "");
      setOrigUsername(profile.username || "");
      
      // Migration for old "website" field
      if (profile.website && (!profile.links || profile.links.length === 0)) {
        setLinks([{ id: "website-migrated", label: "Website", url: profile.website }]);
      }
    }
  }, [profile]);

  const updateProfile = useMutation({
    mutationFn: async () => {
      // Claim a new handle first (if changed) so the saved username is valid.
      if (username.trim() && username.trim().toLowerCase() !== origUsername.toLowerCase()) {
        const res = await claimUsername(user!.id, username);
        if (!res.ok) throw new Error(res.error ?? "Couldn't set that username");
        setUsername(res.username!);
        setOrigUsername(res.username!);
      }
      // setDoc(merge) so it works even if the profile doc doesn't exist yet
      // (e.g. Google sign-ups) — updateDoc would throw "No document to update".
      await setDoc(doc(db, "profiles", user!.id), {
        full_name: fullName,
        headline,
        bio,
        avatar_url: avatarUrl,
        resume_url: resumeUrl,
        resume_filename: resumeFilename,
        links,
        certificates,
        awards,
        education,
        visibility,
        location: location || null,
        geo: geo || null,
      }, { merge: true });
    },
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["my-profile", user?.id] });
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
      navigate({ to: "/profile/$userId", params: { userId: user!.id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadToBlob(file, `avatars/${user.id}`);
      setAvatarUrl(url);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function uploadResume(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingResume(true);
    try {
      const url = await uploadToBlob(file, `resumes/${user.id}`);
      setResumeUrl(url);
      setResumeFilename(file.name);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setUploadingResume(false);
    }
  }

  async function uploadImageFile(file: File, folder: string): Promise<string> {
    return uploadToBlob(file, `${folder}/${user!.id}`);
  }

  async function setCertImage(index: number, file: File) {
    try {
      const url = await uploadImageFile(file, "cert-images");
      setCertificates((cs) => cs.map((c, i) => (i === index ? { ...c, image: url } : c)));
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); }
  }
  async function setAwardImage(index: number, file: File) {
    try {
      const url = await uploadImageFile(file, "award-images");
      setAwards((a) => a.map((w, i) => (i === index ? { ...w, image: url } : w)));
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); }
  }
  async function setEduCert(index: number, file: File) {
    try {
      const url = await uploadImageFile(file, "edu-certs");
      setEducation((e) => e.map((ed, i) => (i === index ? { ...ed, certificate: url } : ed)));
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); }
  }

  function detectLocation() {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setGeo({ lat, lng });
        try {
          // Accurate reverse geocode via Google Maps (server-side to avoid CORS).
          const res = await geocodeFn({ data: { lat, lng } }) as { location: string | null; error: string | null };
          if (res.location) { setLocation(res.location); toast.success("Location detected — remember to Save"); }
          else toast.message("Coordinates captured — add your city manually" + (res.error ? ` (${res.error})` : ""));
        } catch { toast.message("Coordinates captured — add your city manually"); }
        finally { setDetecting(false); }
      },
      () => { setDetecting(false); toast.error("Couldn't get your location"); },
      { timeout: 10000 },
    );
  }

  const handleDragEnd = (result: any, list: any[], setList: any) => {
    if (!result.destination) return;
    const items = Array.from(list);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setList(items);
  };

  return (
    <div className="bg-ambient min-h-screen">
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-10 pb-32">
        <Link to={user ? `/profile/$userId` : "/"} params={user ? { userId: user.id } : {} as any} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to profile
        </Link>
        <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">Edit Profile</h1>

        {isLoading ? (
          <div className="mt-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="glass mt-6 rounded-3xl p-6 sm:p-8 space-y-8">
            {/* Basic Info */}
            <section className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight border-b border-border/60 pb-2">Basic Info</h2>
              <div>
                <label className="block text-sm font-medium text-foreground">Avatar</label>
                <div className="mt-2 flex items-center gap-4">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-secondary" />
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary/60">
                    {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload image
                    <input type="file" accept="image/*" className="hidden" onChange={uploadAvatar} disabled={uploadingAvatar} />
                  </label>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-foreground">Full Name</label>
                  <input
                    value={fullName} onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Headline</label>
                  <input
                    value={headline} onChange={(e) => setHeadline(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                    placeholder="Software Engineer"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Bio</label>
                <textarea
                  value={bio} onChange={(e) => setBio(e.target.value)} rows={4}
                  className="mt-1 w-full resize-none rounded-2xl border border-border bg-background/60 p-4 text-sm outline-none focus:border-foreground/30"
                  placeholder="Tell us about yourself..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Location <span className="text-muted-foreground font-normal">(optional — helps us surface nearby jobs)</span></label>
                <div className="mt-1 flex gap-2">
                  <input
                    value={location} onChange={(e) => setLocation(e.target.value)}
                    className="flex-1 rounded-2xl border border-border bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-foreground/30"
                    placeholder="Bangalore, India"
                  />
                  <button type="button" onClick={detectLocation} disabled={detecting} className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-secondary/60 disabled:opacity-60">
                    {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Detect
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground">Profile link</label>
                <div className="mt-1 flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-4 py-2.5 focus-within:border-foreground/30">
                  <AtSign className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 text-sm text-muted-foreground">crux.app/</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    className="w-full bg-transparent text-sm outline-none"
                    placeholder="yourname"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Your shareable public profile URL. Letters, numbers, underscore.</p>
              </div>
            </section>

            {/* Resume */}
            <section className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight border-b border-border/60 pb-2">Resume</h2>
              <div className="flex items-center gap-4">
                {resumeUrl ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-4 py-2 text-sm">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="max-w-[200px] truncate">{resumeFilename}</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">No resume attached</span>
                )}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary/60">
                  {uploadingResume ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload PDF
                  <input type="file" accept=".pdf" className="hidden" onChange={uploadResume} disabled={uploadingResume} />
                </label>
              </div>
            </section>

            {/* Links */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <h2 className="text-xl font-semibold tracking-tight">Social & Links</h2>
                <button onClick={() => setLinks([...links, { id: Date.now().toString(), label: "", url: "" }])} className="text-primary hover:opacity-80"><Plus className="h-5 w-5" /></button>
              </div>
              <DragDropContext onDragEnd={(res) => handleDragEnd(res, links, setLinks)}>
                <Droppable droppableId="links-list">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                      {links.map((link, index) => (
                        <Draggable key={link.id} draggableId={link.id} index={index}>
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} style={provided.draggableProps.style as React.CSSProperties} className="flex items-center gap-2 rounded-2xl border border-border bg-background/40 p-2">
                              <div {...provided.dragHandleProps} className="p-2 text-muted-foreground hover:text-foreground"><GripVertical className="h-4 w-4" /></div>
                              <input value={link.label} onChange={(e) => { const n = [...links]; n[index].label = e.target.value; setLinks(n); }} placeholder="Label (e.g. GitHub)" className="w-1/3 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                              <input value={link.url} onChange={(e) => { const n = [...links]; n[index].url = e.target.value; setLinks(n); }} placeholder="https://" className="flex-1 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                              <button onClick={() => setLinks(links.filter((_, i) => i !== index))} className="p-2 text-destructive hover:opacity-80"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </section>

            {/* Education */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <h2 className="text-xl font-semibold tracking-tight">Education</h2>
                <button type="button" onClick={() => setEducation([...education, { id: Date.now().toString(), institution: "", degree: "", field: "", start_year: "", end_year: "" }])} className="text-primary hover:opacity-80"><Plus className="h-5 w-5" /></button>
              </div>
              <div className="space-y-3">
                {education.map((ed, index) => (
                  <div key={ed.id} className="rounded-2xl border border-border bg-background/40 p-3">
                    <div className="flex items-start gap-2">
                      <label className="grid h-16 w-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-xl border border-border/50 bg-background text-muted-foreground hover:bg-secondary/60" title="Attach graduation certificate (optional)">
                        {ed.certificate ? <img src={ed.certificate} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5" />}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && setEduCert(index, e.target.files[0])} />
                      </label>
                      <div className="flex-1 space-y-2">
                        <input value={ed.institution} onChange={(e) => { const n = [...education]; n[index].institution = e.target.value; setEducation(n); }} placeholder="Institution / University" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={ed.degree} onChange={(e) => { const n = [...education]; n[index].degree = e.target.value; setEducation(n); }} placeholder="Degree (e.g. B.Tech)" className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                          <input value={ed.field} onChange={(e) => { const n = [...education]; n[index].field = e.target.value; setEducation(n); }} placeholder="Field of study" className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={ed.start_year} onChange={(e) => { const n = [...education]; n[index].start_year = e.target.value; setEducation(n); }} placeholder="Start year" className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                          <input value={ed.end_year} onChange={(e) => { const n = [...education]; n[index].end_year = e.target.value; setEducation(n); }} placeholder="End year (or expected)" className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                        </div>
                      </div>
                      <button type="button" onClick={() => setEducation(education.filter((_, i) => i !== index))} className="p-2 text-destructive hover:opacity-80"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Graduation certificate image is optional.</p>
              </div>
            </section>

            {/* Course Certificates */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <h2 className="text-xl font-semibold tracking-tight">Course Certificates</h2>
                <button onClick={() => setCertificates([...certificates, { id: Date.now().toString(), name: "", issuer: "" }])} className="text-primary hover:opacity-80"><Plus className="h-5 w-5" /></button>
              </div>
              <DragDropContext onDragEnd={(res) => handleDragEnd(res, certificates, setCertificates)}>
                <Droppable droppableId="certs-list">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                      {certificates.map((cert, index) => (
                        <Draggable key={cert.id} draggableId={cert.id} index={index}>
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} style={provided.draggableProps.style as React.CSSProperties} className="flex items-center gap-2 rounded-2xl border border-border bg-background/40 p-2">
                              <div {...provided.dragHandleProps} className="p-2 text-muted-foreground hover:text-foreground"><GripVertical className="h-4 w-4" /></div>
                              <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-xl border border-border/50 bg-background text-muted-foreground hover:bg-secondary/60" title="Attach certificate image">
                                {cert.image ? <img src={cert.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-4 w-4" />}
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && setCertImage(index, e.target.files[0])} />
                              </label>
                              <input value={cert.name} onChange={(e) => { const n = [...certificates]; n[index].name = e.target.value; setCertificates(n); }} placeholder="Course Name" className="w-1/2 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                              <input value={cert.issuer} onChange={(e) => { const n = [...certificates]; n[index].issuer = e.target.value; setCertificates(n); }} placeholder="Issuer (e.g. Coursera)" className="flex-1 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                              <button onClick={() => setCertificates(certificates.filter((_, i) => i !== index))} className="p-2 text-destructive hover:opacity-80"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </section>

            {/* Awards & Prizes */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <h2 className="text-xl font-semibold tracking-tight">Awards & Prizes</h2>
                <button onClick={() => setAwards([...awards, { id: Date.now().toString(), title: "", description: "" }])} className="text-primary hover:opacity-80"><Plus className="h-5 w-5" /></button>
              </div>
              <DragDropContext onDragEnd={(res) => handleDragEnd(res, awards, setAwards)}>
                <Droppable droppableId="awards-list">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                      {awards.map((award, index) => (
                        <Draggable key={award.id} draggableId={award.id} index={index}>
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} style={provided.draggableProps.style as React.CSSProperties} className="flex flex-col gap-2 rounded-2xl border border-border bg-background/40 p-3 sm:flex-row sm:items-center">
                              <div {...provided.dragHandleProps} className="hidden p-2 text-muted-foreground hover:text-foreground sm:block"><GripVertical className="h-4 w-4" /></div>
                              <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center self-start overflow-hidden rounded-xl border border-border/50 bg-background text-muted-foreground hover:bg-secondary/60" title="Attach award image">
                                {award.image ? <img src={award.image} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-4 w-4" />}
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && setAwardImage(index, e.target.files[0])} />
                              </label>
                              <div className="flex-1 space-y-2">
                                <input value={award.title} onChange={(e) => { const n = [...awards]; n[index].title = e.target.value; setAwards(n); }} placeholder="Award Title" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                                <input value={award.description} onChange={(e) => { const n = [...awards]; n[index].description = e.target.value; setAwards(n); }} placeholder="Short description" className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                              </div>
                              <button onClick={() => setAwards(awards.filter((_, i) => i !== index))} className="self-end p-2 text-destructive hover:opacity-80 sm:self-auto"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </section>

            {/* Visibility */}
            <section className="space-y-4">
              <div className="border-b border-border/60 pb-2">
                <h2 className="text-xl font-semibold tracking-tight">Public visibility</h2>
                <p className="mt-1 text-xs text-muted-foreground">Choose what others see on your public profile. (You always see everything here.)</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  { key: "location", label: "Location" },
                  { key: "resume", label: "Resume" },
                  { key: "education", label: "Education" },
                  { key: "certificates", label: "Certificates" },
                  { key: "awards", label: "Awards & prizes" },
                  { key: "showcase", label: "Showcase posts" },
                ] as const).map(({ key, label }) => {
                  const on = visibility[key] !== false;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setVisibility((v) => ({ ...v, [key]: !on }))}
                      className="flex items-center justify-between rounded-2xl border border-border bg-background/40 px-4 py-3 text-sm hover:bg-secondary/40"
                    >
                      <span>{label}</span>
                      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-secondary"}`}>
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="fixed bottom-6 left-0 right-0 z-10 flex justify-center px-4">
              <button
                onClick={() => updateProfile.mutate()}
                disabled={updateProfile.isPending}
                className="w-full max-w-sm inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-2xl hover:opacity-90 disabled:opacity-50"
              >
                {updateProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save Profile Changes
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
