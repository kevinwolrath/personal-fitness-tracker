import { forwardRef } from 'react';
import { ScrollView as NativeScrollView, type ScrollViewProps } from 'react-native';

type Props = Omit<ScrollViewProps, 'showsHorizontalScrollIndicator' | 'showsVerticalScrollIndicator'>;

/** Global mobile contract: hide indicators, never disable scrolling or change layout. */
export const ScrollView = forwardRef<NativeScrollView, Props>(function ScrollView(props, ref) {
  return <NativeScrollView {...props} ref={ref} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false} />;
});

/** Preserve native imperative methods (scrollTo, scrollToEnd, etc.) for existing refs. */
export type ScrollView = NativeScrollView;
