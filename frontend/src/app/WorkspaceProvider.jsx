import { Provider } from 'react-redux';
import { useState } from 'react';
import { workspaceStore } from '../store/store';
export default function WorkspaceProvider({ children, owner }) {
  const [store] = useState(() => workspaceStore(owner));
  return <Provider store={store}>{children}</Provider>;
}
