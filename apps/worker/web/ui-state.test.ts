import { beforeAll, describe, expect, test } from 'bun:test';
import { uiHidden } from '@ext/lib/ui-state';
import { annotationPanelOpen, focusedAnnotationId, showAnnotationPanel, wirePanelState } from './ui-state';

beforeAll(() => wirePanelState());

describe('annotation panel state', () => {
  test('hiding the UI closes the panel without forgetting it was open', () => {
    showAnnotationPanel.value = true;
    expect(annotationPanelOpen.value).toBe(true);

    uiHidden.value = true;
    expect(annotationPanelOpen.value).toBe(false);
    expect(showAnnotationPanel.value).toBe(true);

    uiHidden.value = false;
    expect(annotationPanelOpen.value).toBe(true);
    showAnnotationPanel.value = false;
  });

  test('closing the panel drops the focused annotation, so reopening is never stale', () => {
    showAnnotationPanel.value = true;
    focusedAnnotationId.value = 'c1';
    showAnnotationPanel.value = false;
    expect(focusedAnnotationId.value).toBeNull();
  });
});
