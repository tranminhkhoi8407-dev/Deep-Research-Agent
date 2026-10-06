import { forwardRef, useMemo, type ComponentType, type ReactNode } from 'react';
import { Menu as MantineMenu } from '@mantine/core';
import { ComponentsContext, PortalElementOverride, useComponentsContext, usePortalElement, type ComponentProps } from '@blocknote/react';

type MenuRootProps = ComponentProps['Generic']['Menu']['Root'];
type MenuDropdownProps = ComponentProps['Generic']['Menu']['Dropdown'];
// BlockNote publishes React 19's broader ReactNode return type; this React 18
// app supplies an element child, which the override always renders as an element.
const EditorPortal = PortalElementOverride as ComponentType<{ target?: HTMLElement; children: ReactNode }>;

/** Keep nested menus outside the drag menu's scroll/size boundary.
 * BlockNote's Mantine adapter ignores portalElement for submenus. In a
 * scrollable drag menu this both clips them and shrinks their available width.
 * Override only this menu tree, including the built-in BlockColorsItem.
 */
export function NotebookMenuPortal({ children }: { children: ReactNode }) {
  return <EditorPortal target={typeof document === 'undefined' ? undefined : document.body}>
    <NotebookMenuComponents>{children}</NotebookMenuComponents>
  </EditorPortal>;
}

function NotebookMenuComponents({ children }: { children: ReactNode }) {
  const components = useComponentsContext()!;
  const inheritedPortal = usePortalElement();
  const portalledComponents = useMemo(() => {
    const BaseRoot = components.Generic.Menu.Root;
    const BaseDropdown = components.Generic.Menu.Dropdown;
    function Root(props: MenuRootProps) {
      if (!props.sub) return <BaseRoot {...props} />;
      const portalElement = props.portalElement || inheritedPortal;
      return <MantineMenu.Sub
        withinPortal
        portalProps={portalElement ? { target: portalElement } : undefined}
        floatingStrategy="fixed"
        position={props.position === 'right' ? 'right-start' : props.position}
        offset={4}
        closeDelay={150}
        transitionProps={{ duration: 100 }}
        middlewares={{
          flip: { padding: 8 },
          shift: { padding: 8, crossAxis: true },
          size: {
            padding: 8,
            apply({ availableWidth, availableHeight, elements }) {
              const limit = elements.floating.classList.contains('notebook-turn-into') ? 420 : 600;
              Object.assign(elements.floating.style, {
                maxWidth: `${Math.max(0, availableWidth)}px`,
                maxHeight: `${Math.max(0, Math.min(availableHeight, limit))}px`,
              });
            },
          },
        }}
        onChange={props.onOpenChange}
      >{props.children}</MantineMenu.Sub>;
    }
    const Dropdown = forwardRef<HTMLDivElement, MenuDropdownProps>((props, ref) => {
      if (!props.sub) return <BaseDropdown {...props} />;
      return <MantineMenu.Sub.Dropdown
        className={props.className}
        ref={ref}
        // The main menu's document-level outside-click handler cannot see a
        // portalled child. Let pointer/keyboard selection run before it closes.
        onMouseDown={event => event.stopPropagation()}
        onTouchStart={event => event.stopPropagation()}
      >
        {/* Mantine Sub.Dropdown currently drops its onKeyDown prop. Keep a
            bubbling boundary around items so Enter/Space can activate them. */}
        <div onKeyDown={event => event.stopPropagation()}>{props.children}</div>
      </MantineMenu.Sub.Dropdown>;
    });
    Dropdown.displayName = 'NotebookSubmenuDropdown';
    return { ...components, Generic: { ...components.Generic, Menu: { ...components.Generic.Menu, Root, Dropdown } } };
  }, [components, inheritedPortal]);
  return <ComponentsContext.Provider value={portalledComponents}>{children}</ComponentsContext.Provider>;
}
