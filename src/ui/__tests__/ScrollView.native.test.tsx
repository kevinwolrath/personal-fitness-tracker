import { createRef } from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from '../ScrollView';

it.each([false, true])('suppresses both indicators without disabling scrolling (horizontal=%s)', horizontal => {
  const ref = createRef<ScrollView>();
  const onScroll = jest.fn();
  render(<ScrollView ref={ref} testID="scroll" horizontal={horizontal} onScroll={onScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}><Text>Last item</Text></ScrollView>);
  const scroll = screen.getByTestId('scroll');
  expect(scroll.props.showsVerticalScrollIndicator).toBe(false);
  expect(scroll.props.showsHorizontalScrollIndicator).toBe(false);
  expect(scroll.props.scrollEnabled).not.toBe(false);
  expect(scroll.props.horizontal).toBe(horizontal);
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(scroll.props.contentContainerStyle).toEqual({ paddingBottom: 24 });
  expect(ref.current?.scrollTo).toEqual(expect.any(Function));
  expect(ref.current?.scrollToEnd).toEqual(expect.any(Function));
  fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: horizontal ? 120 : 0, y: horizontal ? 0 : 120 } } });
  expect(onScroll).toHaveBeenCalledTimes(1);
});
