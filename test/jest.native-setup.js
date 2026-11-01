// Native-only modules that have no implementation in the Jest host environment.
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  const DateTimePicker = (props) => React.createElement(View, { testID: 'native-date-picker', ...props });
  return { __esModule: true, default: DateTimePicker, DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() } };
});
