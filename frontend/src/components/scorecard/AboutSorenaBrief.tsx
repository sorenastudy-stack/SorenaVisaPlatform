// PR-SCORECARD-2 — "About Sorena Visa" mini-brief.
//
// Rendered ONLY on /scorecard (form) and /scorecard/result. The
// /scorecard/landing page has much more elaborate value-prop sections
// of its own; repeating this card there would be noise.

export function AboutSorenaBrief() {
  return (
    <div className="max-w-[720px] mx-auto my-6 px-4 sm:px-0">
      <div className="bg-[#FAF8F3] border border-[#1E3A5F]/10 rounded-xl p-5 sm:p-6">
        <h2 className="text-[#1E3A5F] font-bold text-sm uppercase tracking-wide mb-2">
          About Sorena Visa
        </h2>
        <p className="text-[#4A4A4A] text-base leading-relaxed">
          Sorena Visa is a New Zealand&ndash;based education and immigration consultancy. We&rsquo;re authorised agents for universities in New Zealand and Malaysia, helping students secure offers of place, visa approval, and successful settlement abroad.
        </p>
      </div>
    </div>
  );
}
