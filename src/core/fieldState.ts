import { observable, action, computed, runInAction } from 'mobx';
import { ComposibleValidatable, Validator, applyValidators } from './types';
import { debounce } from '../internal/utils';

/**
 * Helps maintain the value + error information about a field
 *
 * This is the glue between the *page* and *field* in the presence of invalid states.
 */
export class FieldState<TValue> implements ComposibleValidatable<TValue> {
  /**
   * The value you should bind to the input in your field.
   */
  @observable value: TValue;

  /** If there is any error on the field on last validation attempt */
  @observable error?: string;

  /** The value set from code or a `value` that's been validated */
  @observable $: TValue;

  /**
   * Set to true if a validation run has been completed since init
   * Use case:
   * - to show a green color in the field if `hasError` is false
   **/
  @observable hasBeenValidated: boolean = false;

  @observable private _autoValidationEnabled = true;
  @action public enableAutoValidation = () => {
    this._autoValidationEnabled = true;
    return this;
  }
  @action public enableAutoValidationAndValidate = () => {
    this._autoValidationEnabled = true;
    return this.validate();
  }
  @action public disableAutoValidation = () => {
    this._autoValidationEnabled = false;
    return this;
  }
  constructor(value: TValue) {
    runInAction(() => {
      this.value = value;
      this.$ = value;
      /**
       * Automatic validation configuration
       */
      this.queueValidation = action(debounce(this.queuedValidationWakeup, 200));
      this._autoValidationEnabled = true;
    })
  }

  private _validators: Validator<TValue>[] = [];
  @action validators = (...validators: Validator<TValue>[]) => {
    this._validators = validators;
    return this;
  }
  private _onUpdate: (state: FieldState<TValue>) => any;
  @action public onUpdate = (handler: (state: FieldState<TValue>) => any) => {
    this._onUpdate = handler;
    return this;
  }

  @action public setAutoValidationDebouncedMs = (milliseconds: number) => {
    this.queueValidation = action(debounce(this.queuedValidationWakeup, milliseconds));
    return this;
  }

  /** Trackers for validation */
  @observable private lastValidationRequest: number = 0;
  @observable private preventNextQueuedValidation = false;

  /** On change on the component side */
  @action onChange = (value: TValue) => {
    // no long prevent any debounced validation request
    this.preventNextQueuedValidation = false;

    // Immediately set for local ui binding
    this.value = value;
    this.executeOnUpdate();
    if (this._autoValidationEnabled) {
      this.queueValidation();
    }
  }

  /**
   * If the page wants to reinitialize the field with a new value,
   * it should call this function
   */
  @action reinitValue = (value: TValue) => {
    // If a previous validation comes back ignore it
    this.preventNextQueuedValidation = true;

    // This value vetos all previous values
    this.value = value;
    this.error = undefined;
    this.hasBeenValidated = false;
    this.$ = value;
    this.on$Reinit();
    this.executeOnUpdate();
  }

  get hasError() {
    return !!this.error;
  }

  @observable validating: boolean = false;

  /**
   * Runs validation on the current value immediately
   */
  @action validate = (): Promise<{ hasError: true } | { hasError: false, value: TValue }> => {
    this.lastValidationRequest++;
    const lastValidationRequest = this.lastValidationRequest;
    this.validating = true;
    const value = this.value;
    return applyValidators(this.value, this._validators || [])
      .then(action((fieldError: string) => {

        /**
         * If validation comes back out of order then the result of this validation is not siginificant
         * We simply copy the value from the last validation attempt
         */
        if (this.lastValidationRequest !== lastValidationRequest) {
          if (this.hasError) {
            return { hasError: true };
          }
          else {
            return {
              hasError: false,
              value: this.$,
            };
          }
        }

        this.validating = false;
        this.hasBeenValidated = true;

        /** For any change in field error, update our error */
        if (fieldError != this.error) {
          this.error = fieldError;
        }

        /** Check for error */
        const hasError = this.hasError;

        /** If no error, copy over the value to validated value */
        if (!hasError) {
          if (this.$ !== value) {
            this.$ = value;
            this.on$ChangeAfterValidation()
          }
        }

        /** before returning update */
        this.executeOnUpdate();

        /** return a result based on error status */
        if (hasError) {
          return { hasError };
        }
        else {
          return {
            hasError,
            value
          };
        }
      }));
  }

  @action queuedValidationWakeup = () => {
    if (this.preventNextQueuedValidation) {
      this.preventNextQueuedValidation = false;
      return;
    }
    this.validate();
  }
  /**
   * Runs validation with debouncing to keep the UI super smoothly responsive
   * NOTE: also setup in constructor
   */
  private queueValidation = action(debounce(this.queuedValidationWakeup, 200));

  @action private executeOnUpdate = () => {
    this._onUpdate && this._onUpdate(this);
  }

  /**
   * Composible fields (fields that work in conjuction with FormState)
   */
  @action on$ChangeAfterValidation = () => { }
  @action on$Reinit = () => { }
  @action setCompositionParent = (config: {
    on$ChangeAfterValidation: () => void;
    on$Reinit: () => void;
  }) => {
    this.on$ChangeAfterValidation = config.on$ChangeAfterValidation;
    this.on$Reinit = config.on$Reinit;
  }
}
