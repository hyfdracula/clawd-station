# Product

## Register

product

## Users

This is a personal desktop workspace for the owner of this machine. The user is already comfortable with Claude Code in the terminal, but wants a calmer, more legible way to manage multiple Claude Code conversations from a desktop interface.

The user is usually working inside local project directories, sending implementation or investigation tasks to Claude Code, attaching local files, and returning to previous sessions later. The interface should help them stay oriented across sessions without exposing terminal noise unless it is genuinely useful.

## Product Purpose

This product is a Claude Code desktop client shell. It turns Claude Code's terminal-first workflow into a chat-like desktop workbench with local conversation history, session management, file attachments, and a focused transcript.

The app should make Claude Code feel like a quiet personal workbench:

- The left sidebar manages conversations: create, search, pin, rename, delete, and review title plus update time.
- The main conversation area shows the current title, working directory or local session information, Claude Code status, and the curated exchange between the user and Claude Code.
- The transcript should preserve user messages, Claude Code replies, and key outputs, while filtering away full terminal clutter.
- Empty conversations should gently guide the user to type a task or add files.
- The bottom composer should support multiline input, fixed placement, keyboard send shortcuts, local file picking, drag-and-drop attachments, attachment tags, removal, and sending file paths together with the task.
- Local records should begin from this app: sessions, attachments, transcript files, update times, and pinned state are stored locally; deleting a session deletes its corresponding local record.

Success means the user can run and revisit Claude Code work from a desktop chat interface without losing the practical power of local paths, files, and project context.

## Brand Personality

Light, focused, and quietly warm.

The product should feel personal rather than corporate: clear enough for sustained technical work, soft enough that long sessions do not feel like staring at a raw terminal, and restrained enough that the interface disappears when the conversation matters.

## Anti-references

This should not feel businesslike, stiff, boxed-in, low-end, visually noisy, or complicated.

Avoid:

- enterprise SaaS dashboards with heavy borders and rigid panels
- generic chat apps that ignore local project context
- decorative UI that competes with code and conversation
- terminal replicas that simply restyle raw output
- overdesigned workflows that add steps to simple actions like sending, attaching, renaming, or deleting

## Design Principles

1. Keep the workbench calm.
   The interface should reduce operational friction and visual noise, especially during long coding sessions.

2. Preserve local orientation.
   The user should always understand which conversation, working directory, local record, and Claude Code state they are looking at.

3. Curate the transcript.
   Show the conversation and key outputs, not the full mess of terminal execution unless the user explicitly needs it.

4. Make file work feel native.
   Adding, previewing, removing, and sending local files should feel like a first-class desktop workflow, not a bolted-on upload pattern.

5. Keep actions close and obvious.
   Conversation management, send shortcuts, pinned state, deletion, and attachment actions should be discoverable without turning the UI into a control panel.

## Accessibility & Inclusion

The interface should be comfortably readable, keyboard-operable, and usable without relying on color alone to communicate state.

It should support reduced motion, clear focus states, predictable tab order, sufficient text contrast, and resilient interaction patterns for drag-and-drop alternatives. Motion should explain state changes, not decorate the product.
