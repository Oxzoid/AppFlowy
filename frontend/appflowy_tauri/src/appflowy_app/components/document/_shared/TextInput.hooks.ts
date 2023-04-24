import { useCallback, useContext, useMemo, useRef, useEffect } from 'react';
import { DocumentControllerContext } from '$app/stores/effects/document/document_controller';
import { TextDelta } from '$app/interfaces/document';
import { debounce } from '@/appflowy_app/utils/tool';
import { NodeContext } from './SubscribeNode.hooks';
import { BlockActionTypePB } from '@/services/backend/models/flowy-document2';
import { useAppDispatch, useAppSelector } from '@/appflowy_app/stores/store';
import { documentActions, TextSelection } from '@/appflowy_app/stores/reducers/document/slice';

import { createEditor, Transforms } from 'slate';
import { withReact, ReactEditor } from 'slate-react';

import * as Y from 'yjs';
import { withYjs, YjsEditor, slateNodesToInsertDelta } from '@slate-yjs/core';

export function useTextInput(id: string, delta: TextDelta[]) {
  const { sendDelta } = useTransact();
  const { editor, yText } = useBindYjs(delta, sendDelta);
  const dispatch = useAppDispatch();
  const currentSelection = useAppSelector((state) => state.document.textSelections[id]);

  useEffect(() => {
    if (!currentSelection || !currentSelection.anchor || !currentSelection.focus) return;
    ReactEditor.focus(editor);
    Transforms.select(editor, currentSelection);
  }, [currentSelection, editor]);

  const onSelectionChange = useCallback(
    (selection?: TextSelection) => {
      dispatch(
        documentActions.setTextSelection({
          blockId: id,
          selection,
        })
      );
    },
    [id]
  );

  return {
    editor,
    yText,
    onSelectionChange,
  };
}

function useController() {
  const docController = useContext(DocumentControllerContext);
  const node = useContext(NodeContext);
  const dispatch = useAppDispatch();

  const update = useCallback(
    async (delta: TextDelta[]) => {
      if (!docController || !node) return;
      await docController.applyActions([
        {
          action: BlockActionTypePB.Update,
          payload: {
            block: {
              id: node.id,
              ty: node.type,
              parent_id: node.parent || '',
              children_id: node.children,
              data: JSON.stringify({
                ...node.data,
                delta,
              }),
            },
          },
        },
      ]);
      dispatch(
        documentActions.setBlockMap({
          ...node,
          data: {
            delta,
          },
        })
      );
    },
    [docController, node]
  );

  return {
    update,
  };
}

function useTransact() {
  const { update } = useController();

  const sendDelta = useCallback(
    (delta: TextDelta[]) => {
      void update(delta);
    },
    [update]
  );
  const debounceSendDelta = useMemo(() => debounce(sendDelta, 300), [sendDelta]);

  return {
    sendDelta: debounceSendDelta,
  };
}

const initialValue = [
  {
    type: 'paragraph',
    children: [{ text: '' }],
  },
];

function useBindYjs(delta: TextDelta[], update: (_delta: TextDelta[]) => void) {
  const yTextRef = useRef<Y.XmlText>();
  // Create a yjs document and get the shared type
  const sharedType = useMemo(() => {
    const doc = new Y.Doc();
    const _sharedType = doc.get('content', Y.XmlText) as Y.XmlText;

    const insertDelta = slateNodesToInsertDelta(initialValue);
    // Load the initial value into the yjs document
    _sharedType.applyDelta(insertDelta);

    const yText = insertDelta[0].insert as Y.XmlText;
    yTextRef.current = yText;

    return _sharedType;
  }, []);

  const editor = useMemo(() => withYjs(withReact(createEditor()), sharedType), []);

  useEffect(() => {
    YjsEditor.connect(editor);
    return () => {
      yTextRef.current = undefined;
      YjsEditor.disconnect(editor);
    };
  }, [editor]);

  useEffect(() => {
    const yText = yTextRef.current;
    if (!yText) return;
    const textEventHandler = (event: Y.YTextEvent) => {
      const textDelta = event.target.toDelta();
      update(textDelta);
    };
    if (JSON.stringify(yText.toDelta()) !== JSON.stringify(delta)) {
      yText.delete(0, yText.length);
      yText.applyDelta(delta);
    }
    yText.observe(textEventHandler);

    return () => {
      yText.unobserve(textEventHandler);
    };
  }, [delta]);

  return { editor, yText: yTextRef.current };
}