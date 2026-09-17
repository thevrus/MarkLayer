---
order: 9
title: "Hypothesis vs MarkLayer: Text Annotation vs Visual"
description: "Hypothesis is the W3C text-annotation layer for scholarly content. MarkLayer is the visual one, with drawings, arrows, and pinned comments anywhere on a page. Both free and open source."
competitor: "Hypothesis"
competitorTagline: "an open-source web annotation layer focused on text-based annotation for academia and research"
homepage: "https://web.hypothes.is"
bottomLine: "Choose MarkLayer for visual feedback on any webpage. Drawings, arrows, and pinned comments anywhere on the page. Choose Hypothesis if you need a public, W3C-standard text annotation layer for scholarly research, classroom reading groups, or article-level discussion."
quote: "Hypothesis is the gold standard for scholarly text annotation. MarkLayer is the visual one, built for when the annotation is an arrow, not a quote. They complement each other; same browser, different workflows."
published: 2026-03-05
modified: 2026-09-17
rows:
  - feature: "Price"
    ml: "Free"
    them: "Free"
  - feature: "Open source"
    ml: "Yes"
    them: "Yes"
  - feature: "Text highlighting + notes"
    ml: "Yes"
    them: "Yes"
  - feature: "Drawing & shapes"
    ml: "Yes (freehand, shapes, arrows)"
    them: "No. Text-only"
  - feature: "Pinned comments anywhere"
    ml: "Yes. Pin to any pixel"
    them: "No. Anchored to text selections"
  - feature: "Real-time live cursors"
    ml: "Yes"
    them: "No"
  - feature: "Sign-up required"
    ml: "No"
    them: "Yes (for sync; anonymous use limited)"
  - feature: "Public annotation layer"
    ml: "No. Share-by-link only"
    them: "Yes. W3C standard, public groups"
  - feature: "Best for"
    ml: "Visual feedback on any webpage"
    them: "Scholarly text annotation, research, teaching"
chooseMl:
  - "You need to draw, point at, or visually mark up parts of a page (not just text)."
  - "You want real-time collaboration with live cursors."
  - "You want zero sign-up."
  - "You're reviewing UI, design, or visual content rather than scholarly text."
chooseThem:
  - "You're annotating academic papers, articles, or text-heavy content."
  - "You need a public, persistent, W3C-standard annotation layer."
  - "You're building educational workflows where students annotate readings together."
  - "You want annotations that persist on the web outside any single share link."
faq:
  - q: "Are MarkLayer and Hypothesis competitors?"
    a: "They overlap on the surface but solve different problems. Hypothesis is built for scholarly text annotation. MarkLayer is built for visual feedback. Drawings, arrows, comments pinned anywhere on a page."
  - q: "Can I use both?"
    a: "Yes. They don't conflict. You can run Hypothesis for research workflows and MarkLayer for visual UI feedback on the same browser."
  - q: "Does MarkLayer support text-based annotation like Hypothesis?"
    a: "MarkLayer supports highlighting text with comments, but its primary strength is visual annotation. Drawings, shapes, and arrows on the page itself."
  - q: "Is MarkLayer's annotation data public like Hypothesis groups?"
    a: "No. MarkLayer annotations are private until you share the link. There is no public annotation layer or open group system."
  - q: "Which one should a research team actually install?"
    a: "Often both, for different halves of the work. Hypothesis for the literature as a public, standards-based layer: a passage highlighted in a paper, a note, a reading group working through the same PDF over a term. MarkLayer for a working pass on one document or one build: it opens a PDF or an image too, by link or upload, and adds drawing, arrows and pinned comments that a text anchor cannot express, then hands the result to anyone as a link. One is a permanent annotation layer; the other is a review you send."
---

MarkLayer and [Hypothesis](https://web.hypothes.is) are both free and open source, but they anchor to different things on a page. Hypothesis anchors to text: select a passage, and the annotation attaches to that exact string, portable across however the page reflows. MarkLayer anchors to space: draw an arrow at a coordinate, pin a comment to a button, and the mark lives on the visual layout itself, not a string of words.

That distinction decides which tool actually fits a given job, more than any feature comparison does. A research group annotating a journal article, a class discussing a shared reading, a journalist marking up a source document: all three are annotating text, and Hypothesis's W3C-standard, publicly addressable layer is built exactly for that, sign-up required, groups persistent across sessions. A designer circling a misaligned button, a QA engineer flagging a broken layout, a PM pointing at a chart that renders wrong on mobile: none of that is text to select, and Hypothesis has no drawing tool or pixel-anchor to reach for it with.

Where the comparison gets genuinely interesting is a page that's both: a data-heavy article, an annotated report, a research tool with real prose alongside its UI. Nothing stops a team from running Hypothesis for the argument and MarkLayer for the interface on the very same URL; they don't compete for the same anchor point, so neither one has to lose for the other to be the right call.
