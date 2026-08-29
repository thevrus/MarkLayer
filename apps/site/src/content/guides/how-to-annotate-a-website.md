---
order: 2
title: "How to Annotate a Website: 4 Methods and Their Limits"
description: "Four ways to annotate a website: built-in markup, a browser extension, a share link, and developer tools. What each can do, and what each one breaks on."
h1: "How to annotate a website, four ways"
intro: "To annotate a website you have four options: mark up a capture using tools already on your computer, install a browser extension that draws on the live page, open the page through a web annotator and send someone the link, or use your browser's developer tools. Which one is right turns almost entirely on whether anyone else has to reply. I make one of the tools mentioned below, and it is named as one option inside one method rather than as the answer."
bottomLine: "If the annotation is for you, your computer already does it: Edge's Web capture (Ctrl + Shift + S) draws on a full-page screenshot, and on a Mac, Safari's File > Print > PDF opens in Preview's Markup. Chrome has no built-in annotation at all and Firefox's screenshot tool captures without drawing. But every built-in method produces a static file, so the moment someone else has to reply, all four of them stop working and you need a tool that annotates the live page."
published: 2026-08-29
modified: 2026-08-29
faq:
  - q: "How do I annotate a website for free?"
    a: "Use what is already installed. In Microsoft Edge, press Ctrl + Shift + S, choose Capture full page, and draw on the result; Microsoft's own guide says Web capture 'lets you draw on, highlight, share, or copy your capture before saving it'. On a Mac, choose File > Print in Safari, click PDF at the bottom of the print dialog, save the file, and open it in Preview, where the Markup toolbar gives you pen, shapes, text and highlighting. Both are free and neither needs an account. Both produce a file rather than a live page."
  - q: "Can you annotate a website in Chrome?"
    a: "Not with Chrome alone. Chrome ships no annotation feature. Print > Save as PDF gives you a PDF with no markup tools, and the DevTools command 'Capture full size screenshot' gives you a PNG with no markup tools. To draw on a page in Chrome you need an extension, or you open the page through a web annotator that runs in a tab of its own."
  - q: "How do I annotate a whole webpage rather than just the part I can see?"
    a: "You need a full-page capture, which is a separate feature from an ordinary screenshot. Edge has it built in: Ctrl + Shift + S, then Capture full page. On iPhone and iPad, take a screenshot, tap the preview thumbnail, and choose Full Page, which captures the entire scrolling page as a PDF you can mark up. Chrome can do the capture through DevTools but gives you no way to draw on it. Windows Snipping Tool marks up beautifully but has no full-page web capture at all."
  - q: "How do you annotate a website on an iPhone?"
    a: "Screenshot the page, tap the thumbnail that appears in the corner, and switch from Screen to Full Page to capture the whole scrolling page. The Markup tools then work across the entire capture, and you save the result as a PDF. This is the one situation where the built-in route is clearly the best one, because most annotation tools, MarkLayer included, are desktop only."
  - q: "Can two people annotate the same website at the same time?"
    a: "Not with any built-in method, because all of them produce a static file. This is the dividing line in the whole category. Tools that annotate the live page can put several people on the same annotation at once with live cursors and threaded replies. A marked-up screenshot cannot be replied to at all: the other person has to describe their answer in prose, which is the email thread you were trying to escape."
  - q: "How do I annotate a page that needs a login?"
    a: "Use a browser extension. Anything that loads the page in its own tab, including MarkLayer's web app, is fetching the page as an anonymous visitor and will get the login screen rather than your dashboard. An extension draws on the real page in your own browser, already signed in, so admin panels, staging sites behind basic auth, and client dashboards all work."
  - q: "What is the difference between annotating a webpage and screenshotting it?"
    a: "A screenshot is a picture of how the page looked at one moment. An annotation on a live page is attached to an element, so it survives a re-render, a different screen size and, in tools that anchor properly, a redeploy. The practical difference shows up two days later: the screenshot is stale and the person reading it cannot tell whether the problem is fixed, while the live annotation is still pointing at the thing it was pointing at."
  - q: "Is there a way to annotate a website without installing anything?"
    a: "Yes. Web annotators load the page inside their own tab, so nothing is installed on your machine or on the reviewer's. The trade is reach: this route only works on pages that are publicly reachable and willing to load inside another page. YouTube, Instagram, X, Facebook and TikTok all refuse, and anything behind a login is out of scope by definition."
---

## The four methods, and which one you want

| Method | Needs an install? | Annotates | Can someone reply? |
| --- | --- | --- | --- |
| Built-in markup | No, already there | A static capture | No |
| Browser extension | Yes, for you | The live page | Yes, once shared |
| Web annotator link | No, either side | The live page, in a tab | Yes |
| Developer tools | No | Nothing; it copies element data | No |

Pick on the last column. Everything else is detail.

## Method 1: mark up a capture with what you already have

Free, immediate, and the right answer whenever the annotation is for you or for someone who only has to look.

**Microsoft Edge** has the best built-in version on any desktop browser. Press **Ctrl + Shift + S**, or open the **…** menu in the top right and choose **Web capture**. Pick **Capture full page** to get the whole scrolling page rather than the visible part. Microsoft's own guide describes what you get next: Web capture "lets you draw on, highlight, share, or copy your capture before saving it".

**macOS**, in Safari, takes two steps because Safari has no markup of its own. Choose **File > Print**, click the **PDF** button at the bottom of the print dialog, and save the file. Open it in Preview and use the Markup toolbar, which gives you pen, shapes, text, highlighting and a signature tool.

**iPhone and iPad** have the best mobile route by a distance. Take a screenshot, tap the preview thumbnail before it disappears, then switch from **Screen** to **Full Page**. That captures the entire scrolling page as a PDF, the Markup tools work across all of it, and you save it out. If you are annotating from a phone, stop reading here: this is the method, because nearly every dedicated tool in this category is desktop only.

**Windows Snipping Tool** marks up well, with pen, highlighter, shapes and an eraser, and it will pull text out of an image. It has no full-page web capture, so it only ever sees what is on screen.

Two browsers do less than people expect.

**Chrome ships no annotation feature at all.** Print > Save as PDF produces a PDF with nothing to draw with. The DevTools command "Capture full size screenshot" produces a PNG with nothing to draw with. An article titled "how to annotate a website in Chrome" is therefore always an article about installing something, whether or not the title admits it.

**Firefox Screenshots** captures and does not annotate. Mozilla's own documentation is clear that the tool takes the picture; the drawing is your problem.

## Method 2: an extension that draws on the live page

An extension injects the drawing tools into the page you are already looking at, in your own browser, already signed in. That last part is the whole reason the method exists.

Use it when the page is not publicly reachable: an admin panel, a client's WordPress dashboard, a staging site behind basic auth, a localhost dev server. No tool that loads the page in its own tab can reach any of those, because it arrives as an anonymous visitor and gets the login screen.

The cost is that the install is on you, and on anyone else who wants to draw rather than just read. Most tools in this category, [MarkLayer](https://marklayer.app) included, split the difference: the person creating the annotation installs an extension, and the people receiving it need nothing.

## Method 3: a share link, with nothing installed on either side

A web annotator loads the page inside its own tab and puts the drawing surface on top. Nothing is installed anywhere. You paste a URL, mark it up, and send a link; the other person opens it in whatever browser they have and can usually reply in place.

This is the method to use when the reviewer is someone whose goodwill you are spending: a client, a stakeholder, anyone who will quietly not bother if the first step is an install or a signup. The [staging-site walkthrough](/for/staging-feedback-no-extension) covers that specific handover in detail.

It has one hard limit, and it is worth knowing before you rely on it. The page has to be publicly reachable *and* willing to load inside another page. Checked on 29 August 2026, YouTube, Instagram, X, Facebook and TikTok all refuse. Anything behind a login is excluded by definition, which is what pushes you back to Method 2.

## Method 4: developer tools, when the reader is a machine

Right-click, Inspect, and you have the element: its selector, its computed styles, its position. Nothing is annotated and nothing is shareable, so this is not a review workflow.

It is worth knowing anyway, because the reason to identify an element precisely has changed. Handing a CSS selector and a description to a coding agent is now a normal way to get a UI change made, and a screenshot is useless for it: the agent cannot tell which of forty divs you meant. Some annotation tools now capture the selector for you and pass it along, which is the same job with the manual step removed. The [localhost and AI agents walkthrough](/for/localhost-ai-agents) covers that path.

## The question that actually decides it

Every method in Section 1 ends in a file. A PNG or a PDF, sitting in a Downloads folder, attached to an email.

Files do not answer back. The person you sent it to reads your arrow pointing at the header, agrees, fixes it, and then has to tell you so in prose, because there is nowhere on the file to say "done". You reply asking which of the six things they fixed. This is the email thread the annotation was supposed to replace, and it grew back because the artefact was dead on arrival.

Files also go stale instantly. A screenshot records how the page looked at 14:32 on a Tuesday. By Thursday the page has changed, and nobody can tell whether the comment still applies without opening both and comparing. An annotation bound to an element rather than to a coordinate survives that, which is why the tools worth paying for anchor to the element and not to a pixel position.

So the decision rule is short. Annotating for yourself, or for someone who only has to look: use the built-in method, it is free and already installed. Annotating for someone who has to respond: none of the built-in methods will do, and the choice becomes which tool, which is a [separate and longer question](/guides/website-feedback-tools).

## What breaks

**Pages behind a login** defeat every method except the extension.

**Sites that refuse to be embedded** defeat the share-link method specifically. The big social platforms are the ones you will hit.

**Phones** defeat almost everything except Apple's built-in Full Page capture. The dedicated tools in this category are overwhelmingly desktop only, MarkLayer included, and marklayer.app will say so if you open it on a phone.

**Very long pages** defeat the naive screenshot. If the page scrolls, you need a full-page capture, and only Edge and iOS have one built in that you can then draw on.

**Retention** defeats you later rather than now. A link that expires takes the review round with it. Whatever tool you pick, find out how long it keeps the work before you put a client on it; [most vendors do not publish an answer](/guides/website-feedback-tools).

For a full price and feature comparison of the tools behind Methods 2 and 3, including what each one keeps and for how long, see [twenty-one website feedback tools compared](/guides/website-feedback-tools). For how MarkLayer specifically handles links, drafts and deletion, see [how MarkLayer works](/guides/how-marklayer-works).
