// A modal <dialog> is also the event target for clicks in its own padding, and a
// text selection that ends past the edge produces a click on it. Dismiss only when
// the press both starts and ends outside the dialog box, on the backdrop.
export function outsideDialog(event) {
  const box = event.currentTarget.getBoundingClientRect();
  return event.target === event.currentTarget &&
    (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
}

export function backdropDismiss(close) {
  return {
    onPointerDown: event => { event.currentTarget.dataset.backdropPress = outsideDialog(event) ? 'true' : ''; },
    onClick: event => {
      const pressed = event.currentTarget.dataset.backdropPress === 'true';
      event.currentTarget.dataset.backdropPress = '';
      if (pressed && outsideDialog(event)) close();
    },
  };
}
