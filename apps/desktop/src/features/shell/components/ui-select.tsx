// Shared Radix select: replaces platform-native menus for a consistent desktop UI.

import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface UiSelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export function UiSelect<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
  placeholder,
}: UiSelectProps<T>): JSX.Element {
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      {...(disabled === undefined ? {} : { disabled })}
    >
      <Select.Trigger
        className={`dd-ui-select${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
      >
        <Select.Value {...(placeholder ? { placeholder } : {})} />
        <Select.Icon className="dd-ui-select__icon">
          <ChevronDown size={15} strokeWidth={2} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="dd-ui-select__content" position="popper" sideOffset={6}>
          <Select.Viewport className="dd-ui-select__viewport">
            {options.map((option) => (
              <Select.Item key={option.value} value={option.value} className="dd-ui-select__item">
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="dd-ui-select__check">
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
