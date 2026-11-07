import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { submitBtn } from '@ext/lib/buttons';
import { geist } from '@ext/lib/geist';
import { portalContainer } from '@ext/lib/portal';
import { cn } from '@marklayer/ui/cn';
import { signal, useSignal } from '@preact/signals';
import { Check, Ellipsis, FolderInput, Plus } from 'lucide-preact';
import { type Folder, MAX_FOLDER_NAME_LENGTH, type OwnedLink } from '../../shared/accounts';
import {
  createFolder,
  deleteFolder,
  type FolderFilter,
  folderFilter,
  folders,
  moveLink,
  renameFolder,
} from './session';

type DialogSpec = { kind: 'create' } | { kind: 'rename'; folder: Folder } | { kind: 'delete'; folder: Folder };

const dialog = signal<DialogSpec | null>(null);

const MENU_ITEM =
  'flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-ui cursor-pointer border-none transition-colors bg-transparent text-(--ds-gray-1000) hover:bg-(--ds-gray-alpha-100) data-highlighted:bg-(--ds-gray-alpha-100)';

/** The links a filter leaves on screen. */
export function inFilter({ link, filter }: { link: OwnedLink; filter: FolderFilter }): boolean {
  if (filter.kind === 'all') return true;
  return filter.kind === 'unfiled' ? link.folderId === null : link.folderId === filter.id;
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      class={cn(
        'text-ui h-7 max-w-48 shrink-0 cursor-pointer truncate rounded-md border-none px-2.5 font-medium transition-colors duration-150',
        active
          ? 'bg-(--ds-gray-alpha-200) text-(--ds-gray-1000)'
          : 'bg-transparent text-(--ds-gray-900) hover:bg-(--ds-gray-alpha-100) hover:text-(--ds-gray-1000)',
      )}
    >
      {label}
    </button>
  );
}

/** Filter chips plus the way to make a folder. Folder-level actions live behind the active chip. */
export function FolderBar() {
  const filter = folderFilter.value;
  const active = filter.kind === 'folder' ? folders.value.find((f) => f.id === filter.id) : undefined;
  return (
    <div class="mb-4 flex flex-wrap items-center gap-1">
      <Chip
        label="All"
        active={filter.kind === 'all'}
        onClick={() => {
          folderFilter.value = { kind: 'all' };
        }}
      />
      {folders.value.length > 0 && (
        <Chip
          label="Unfiled"
          active={filter.kind === 'unfiled'}
          onClick={() => {
            folderFilter.value = { kind: 'unfiled' };
          }}
        />
      )}
      {folders.value.map((folder) => (
        <Chip
          key={folder.id}
          label={folder.name}
          active={filter.kind === 'folder' && filter.id === folder.id}
          onClick={() => {
            folderFilter.value = { kind: 'folder', id: folder.id };
          }}
        />
      ))}
      <button
        type="button"
        aria-label="New folder"
        class={cn(geist.ctlSm, geist.ctlIdle, 'size-7')}
        onClick={() => {
          dialog.value = { kind: 'create' };
        }}
      >
        <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {active && <FolderActions folder={active} />}
    </div>
  );
}

function FolderActions({ folder }: { folder: Folder }) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={`Actions for ${folder.name}`} className={cn(geist.ctlSm, geist.ctlIdle, 'size-7')}>
        <Ellipsis size={14} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal container={portalContainer.value ?? undefined}>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-2147483647">
          <Menu.Popup className={cn(geist.surface, 'min-w-40 p-1 text-ui text-(--ds-gray-1000)')}>
            <Menu.Item
              className={MENU_ITEM}
              onClick={() => {
                dialog.value = { kind: 'rename', folder };
              }}
            >
              Rename
            </Menu.Item>
            <Menu.Item
              className={cn(MENU_ITEM, 'hover:text-(--ds-red-700) data-highlighted:text-(--ds-red-700)')}
              onClick={() => {
                dialog.value = { kind: 'delete', folder };
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const NO_FOLDER = '__none__';

/** The row's "Move to folder". A radio group, so the current folder is the checked one. */
export function MoveMenu({ link, class: className }: { link: OwnedLink; class: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label="Move to folder" className={className}>
        <FolderInput size={14} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal container={portalContainer.value ?? undefined}>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-2147483647">
          <Menu.Popup className={cn(geist.surface, 'max-h-80 min-w-48 max-w-72 overflow-y-auto p-1 text-ui')}>
            <div class={cn(geist.sectionLabel, 'px-2.5 pt-1.5 pb-1')}>Move to folder</div>
            <Menu.RadioGroup
              value={link.folderId ?? NO_FOLDER}
              onValueChange={(value: string) =>
                void moveLink({ id: link.id, folderId: value === NO_FOLDER ? null : value })
              }
            >
              <FolderRadio label="No folder" value={NO_FOLDER} />
              {folders.value.map((folder) => (
                <FolderRadio key={folder.id} label={folder.name} value={folder.id} />
              ))}
            </Menu.RadioGroup>
            <div class="mx-2 my-1 h-px bg-(--ds-gray-alpha-400)" />
            <Menu.Item
              className={MENU_ITEM}
              onClick={() => {
                dialog.value = { kind: 'create' };
              }}
            >
              New folder…
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function FolderRadio({ label, value }: { label: string; value: string }) {
  return (
    <Menu.RadioItem value={value} className={cn(MENU_ITEM, 'data-checked:font-medium')}>
      <span class="truncate text-left">{label}</span>
      <Menu.RadioItemIndicator className="inline-flex shrink-0 text-(--ds-gray-900)">
        <Check size={14} strokeWidth={1.5} aria-hidden="true" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}

/** One dialog for create, rename and delete-confirm; mounted once by the dashboard. */
export function FolderDialog() {
  const spec = dialog.value;
  return (
    <Dialog.Root
      open={spec !== null}
      onOpenChange={(open: boolean) => {
        if (!open) dialog.value = null;
      }}
    >
      <Dialog.Portal container={portalContainer.value ?? undefined}>
        <Dialog.Backdrop className="fixed inset-0 z-2147483647 bg-black/50" />
        <Dialog.Popup
          className={cn(
            geist.surface,
            'fixed top-1/2 left-1/2 z-2147483647 w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 p-5',
          )}
        >
          {spec && <DialogBody spec={spec} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DialogBody({ spec }: { spec: DialogSpec }) {
  const name = useSignal(spec.kind === 'rename' ? spec.folder.name : '');
  const error = useSignal<string | null>(null);
  const busy = useSignal(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    busy.value = true;
    if (spec.kind === 'delete') {
      await deleteFolder(spec.folder.id);
      dialog.value = null;
      return;
    }
    const failure =
      spec.kind === 'create'
        ? await createFolder(name.value)
        : await renameFolder({ id: spec.folder.id, name: name.value });
    busy.value = false;
    if (failure) error.value = failure;
    else dialog.value = null;
  };

  return (
    <form onSubmit={submit}>
      <Dialog.Title className="text-heading tracking-ui m-0 font-semibold text-(--ds-gray-1000)">
        {spec.kind === 'create' ? 'New folder' : spec.kind === 'rename' ? 'Rename folder' : 'Delete folder'}
      </Dialog.Title>
      {spec.kind === 'delete' ? (
        <Dialog.Description className="text-ui leading-body mt-2 mb-0 text-(--ds-gray-900)">
          Delete <span class="text-(--ds-gray-1000)">{spec.folder.name}</span>? Its links are not deleted, they move
          back to Unfiled.
        </Dialog.Description>
      ) : (
        <div class="mt-3 flex flex-col gap-2">
          <div class={cn(geist.field, 'flex h-11 items-center px-3 sm:h-10')}>
            <input
              type="text"
              required
              autofocus
              maxLength={MAX_FOLDER_NAME_LENGTH}
              aria-label="Folder name"
              aria-invalid={error.value ? 'true' : undefined}
              placeholder="Folder name"
              value={name.value}
              onInput={(event) => {
                name.value = event.currentTarget.value;
              }}
              /* 16px, not the text-ui step: iOS Safari zooms into any focused input below it. */
              class={cn(geist.input, 'w-full text-base')}
            />
          </div>
          {error.value ? (
            <p role="alert" class="text-meta m-0 text-(--ds-red-700)">
              {error.value}
            </p>
          ) : null}
        </div>
      )}
      <div class="mt-5 flex justify-end gap-2">
        <Dialog.Close className={cn(geist.actionBtn, geist.ctlIdle, 'mx-0')}>Cancel</Dialog.Close>
        <button
          type="submit"
          disabled={busy.value || (spec.kind !== 'delete' && name.value.trim() === '')}
          class={cn(
            spec.kind === 'delete'
              ? cn(geist.actionBtn, 'mx-0 text-(--ds-red-700) hover:bg-(--ds-gray-alpha-100)')
              : submitBtn,
            'disabled:opacity-50',
          )}
        >
          {spec.kind === 'create' ? 'Create' : spec.kind === 'rename' ? 'Save' : 'Delete'}
        </button>
      </div>
    </form>
  );
}
