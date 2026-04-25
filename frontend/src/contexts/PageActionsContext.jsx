import { createContext, useContext, useEffect, useState } from "react";

const PageActionsContext = createContext({
  actions: [],
  setActions: () => {},
});

export function PageActionsProvider({ children }) {
  const [actions, setActions] = useState([]);
  return (
    <PageActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </PageActionsContext.Provider>
  );
}

export function usePageActionsList() {
  return useContext(PageActionsContext).actions;
}

export function usePageActions(actions, deps) {
  const { setActions } = useContext(PageActionsContext);
  useEffect(() => {
    setActions(actions);
    return () => setActions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
