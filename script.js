function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function removeDiacritics(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

class MultipleSelectHierarchy {
  constructor(element, data, options = {}) {
    this.element = element;
    this.data = data;
    this.id = `msh-${Math.random().toString(36).slice(2, 9)}`;
    
    this.domCache = new Map();
    
    this.options = {
      maxSelections: 3,
      placeholder: "Please select",
      searchPlaceholder: "Search",
      allText: "All",
      clearAllText: "Clear all",
      selectedText: "You have selected {n} items",
      defaultSelectionText: "Please select items",
      unitChildText: "Items",
      showGroupHeaders: true,
      ...options,
    };

    this.items = this.processData(data);
    this.selectedItems = {};
    
    if (!MultipleSelectHierarchy.instances) {
      MultipleSelectHierarchy.instances = new WeakMap();
    }
    MultipleSelectHierarchy.instances.set(element, this);

    this.handleSearch = debounce((searchTerm) => {
      const searchLower = removeDiacritics(searchTerm.toLowerCase());
      if (this.selectedParent) {
        this.renderFilteredChildren(searchLower);
      } else {
        this.renderFilteredItems(searchLower);
      }
    }, 150);

    this.init();

    this.abortController = new AbortController();
    this.signal = this.abortController.signal;

    // Add scroll position tracking
    this.scrollPositions = new Map();
  }

  init() {
    this.render();
    this.attachEventListeners();
    this.updateInput();
    this.renderItems(this.items);
  }

  render() {
    const container = document.createElement("div");
    container.className = "multiple-select-hierarchy";
    container.innerHTML = `
            <div class="dropdown">
                <div class="input-group">
                    <div class="form-control d-flex flex-wrap align-items-center" id="${this.id}-chips-container" tabindex="0">
                    </div>
                    <input type="hidden" id="${this.id}-selected-items" name="${this.element.dataset.name || 'selected-items'}">
                </div>
                <div class="card select-card" style="display: none;">
                    <div class="card-body">
                        <h5 class="card-title mb-3">${this.options.placeholder}</h5>
                        <div class="search-container">
                          <div class="search-input-wrapper">
                            <svg class="icon-search" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                              <path d="M14 14L11 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            <input type="text" class="search-input" placeholder="${this.options.searchPlaceholder}" id="${this.id}-search-input">
                          </div>
                        </div>
                        <div id="${this.id}-selection-info" class="mb-2 text-muted">${this.options.defaultSelectionText}</div>
                        <ul class="list-group" id="${this.id}-item-list"></ul>
                    </div>
                </div>
            </div>
        `;

    this.element.appendChild(container);

    this.container = container;
    this.chipsContainer = container.querySelector(`#${this.id}-chips-container`);
    this.selectedItemsInput = container.querySelector(`#${this.id}-selected-items`);
    this.selectCard = container.querySelector(".select-card");
    this.searchInput = container.querySelector(`#${this.id}-search-input`);
    this.selectionInfo = container.querySelector(`#${this.id}-selection-info`);
    this.itemList = container.querySelector(`#${this.id}-item-list`);

    this.cacheElements();
  }

  attachEventListeners() {
    // Prevent form submission when clicking buttons inside the component
    this.container.addEventListener('click', (e) => {
        if (e.target.closest('.btn-link') || e.target.closest('.btn-back')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, { signal: this.signal });

    this.itemList.addEventListener('click', (e) => {
        const target = e.target;
        const btnLink = target.closest('.btn-link');
        
        if (target.matches('.form-check-input')) {
            const itemId = target.id.replace(`${this.id}-item-`, '');
            const item = this.findItemById(parseInt(itemId));
            if (item) {
                this.handleItemSelection(item, target.checked);
            }
        }
        
        if (btnLink) {
            e.preventDefault();
            e.stopPropagation();
            const listItem = btnLink.closest('li');
            const itemId = listItem.querySelector('.form-check-input').id.replace(`${this.id}-item-`, '');
            const item = this.findItemById(parseInt(itemId));
            if (item) {
                this.handleItemClick(item);
            }
        }
    }, { signal: this.signal });

    this.chipsContainer.addEventListener("click", () => {
      this.chipsContainer.focus();
      this.showSelectCard();
    }, { signal: this.signal });

    this.chipsContainer.addEventListener("focus", () => {
      this.chipsContainer.classList.add("focused");
    }, { signal: this.signal });

    this.chipsContainer.addEventListener("blur", () => {
      this.chipsContainer.classList.remove("focused");
    }, { signal: this.signal });

    document.addEventListener("click", (e) => {
      if (
        !this.selectCard.contains(e.target) &&
        !this.chipsContainer.contains(e.target)
      ) {
        this.hideSelectCard();
      }
    }, { signal: this.signal });

    this.selectCard.addEventListener("click", (e) => e.stopPropagation(), 
      { signal: this.signal });
      
    this.searchInput.addEventListener("input", (e) =>
      this.handleSearch(e.target.value),
      { signal: this.signal }
    );
  }

  setItems(items) {
    this.items = items;
    this.renderItems(this.items);
  }

  renderItems(items) {
    const fragment = document.createDocumentFragment();
    const selectedParentCount = Object.keys(this.selectedItems).length;

    items.forEach((group) => {
        // Only create group header if showGroupHeaders is true
        if (this.options.showGroupHeaders) {
            const groupHeader = document.createElement("li");
            groupHeader.className = "list-group-item group-header";
            groupHeader.innerHTML = `
                <div class="group-label">${group.name}</div>
            `;
            fragment.appendChild(groupHeader);
        }

        // Render subgroups under this group
        if (group.children && group.children.length > 0) {
            group.children.forEach(subgroup => {
                const li = this.createItemElement(subgroup, selectedParentCount);
                fragment.appendChild(li);
            });
        }
    });

    this.itemList.innerHTML = '';
    this.itemList.appendChild(fragment);
    this.updateSelectionInfo();
  }

  renderChildren(parent) {
    this.itemList.innerHTML = "";
    
    if (parent.children && parent.children.length > 0) {
        const allChildrenSelected = this.selectedItems[parent.id] === null;
        const selectedChildIds = this.selectedItems[parent.id] || [];

        // Add "All" option at the top
        this.itemList.innerHTML = `
            <li class="list-group-item">
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="${this.id}-allChildren"
                        ${allChildrenSelected ? 'checked' : ''}>
                    <label class="form-check-label" for="${this.id}-allChildren">
                        ${this.options.allText}
                    </label>
                </div>
            </li>
        `;

        parent.children.forEach((child) => {
            const li = document.createElement("li");
            li.className = "list-group-item";
            
            const hasChildren = child.children && child.children.length > 0;
            const isChecked = allChildrenSelected || selectedChildIds.includes(child.id);

            li.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="${this.id}-child-${child.id}" 
                            ${isChecked ? "checked" : ""}>
                        <label class="form-check-label" for="${this.id}-child-${child.id}">
                            ${child.name}
                            ${this.selectedItems[child.id] ? 
                                `<span class="text-black-50">
                                    ${this.selectedItems[child.id] === null ? 
                                        `(${this.options.allText})` : 
                                        `(${this.selectedItems[child.id].length} ${this.options.unitChildText})`}
                                </span>` 
                                : ''}
                        </label>
                    </div>
                    ${hasChildren ? `
                        <button type="button" class="btn btn-link p-0">
                            <svg class="icon-chevron-right" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            `;

            const checkbox = li.querySelector(`#${this.id}-child-${child.id}`);
            checkbox.addEventListener("change", (e) => 
                this.handleChildSelection(parent, child, e.target.checked),
                { signal: this.signal }
            );

            if (hasChildren) {
                const button = li.querySelector('.btn-link');
                button.addEventListener("click", (e) => {
                    e.preventDefault();
                    this.handleItemClick(child);
                }, { signal: this.signal });
            }

            this.itemList.appendChild(li);
        });

        const allChildrenCheckbox = this.itemList.querySelector(`#${this.id}-allChildren`);
        allChildrenCheckbox.addEventListener("change", (e) =>
            this.handleAllChildrenSelection(parent, e.target.checked),
            { signal: this.signal }
        );
    }
  }

  handleItemSelection(item, isChecked) {
    const selectedParentCount = Object.keys(this.selectedItems).length;
    const isNewSelection = !this.selectedItems[item.id];

    if (isChecked && isNewSelection && selectedParentCount >= this.options.maxSelections) {
        setTimeout(() => {
            const checkbox = document.getElementById(`${this.id}-item-${item.id}`);
            if (checkbox) checkbox.checked = false;
        }, 0);
        return;
    }

    if (isChecked) {
        this.selectedItems[item.id] = null;
    } else {
        delete this.selectedItems[item.id];
    }
    
    this.updateInput();
    this.updateSelectionInfo();
    this.renderItems(this.items);
  }

  handleChildSelection(parent, child, isChecked) {
    if (this.selectedItems[parent.id] === null && !isChecked) {
      this.selectedItems[parent.id] = parent.children
        .filter(c => c.id !== child.id)
        .map(c => c.id);
      
      const allChildrenCheckbox = document.getElementById(`${this.id}-allChildren`);
      if (allChildrenCheckbox) {
        allChildrenCheckbox.checked = false;
      }

      this.updateInput();
      this.updateSelectionInfo();
      this.renderChildren(parent);
    }

    if (!this.selectedItems[parent.id]) {
      this.selectedItems[parent.id] = [];
    }

    if (isChecked) {
      if (!this.selectedItems[parent.id].includes(child.id)) {
        this.selectedItems[parent.id].push(child.id);
      }
    } else {
      this.selectedItems[parent.id] = this.selectedItems[parent.id].filter(
        (id) => id !== child.id
      );
    }

    if (this.selectedItems[parent.id].length === 0) {
      delete this.selectedItems[parent.id];
    } else if (
      this.selectedItems[parent.id].length === parent.children.length
    ) {
      this.selectedItems[parent.id] = null;
      const allChildrenCheckbox = document.getElementById(`${this.id}-allChildren`);
      if (allChildrenCheckbox) {
        allChildrenCheckbox.checked = true;
      }
    }

    this.updateInput();
    this.updateSelectionInfo();
    this.renderChildren(parent);
  }

  handleAllChildrenSelection(parent, isChecked) {
    const selectedParentCount = Object.keys(this.selectedItems).length;
    const isNewParentSelection = !this.selectedItems[parent.id];

    if (
      isChecked &&
      isNewParentSelection &&
      selectedParentCount >= this.options.maxSelections
    ) {
      setTimeout(() => {
        const checkbox = document.getElementById(`${this.id}-allChildren`);
        if (checkbox) checkbox.checked = false;
      }, 0);
      return;
    }

    if (isChecked) {
      this.selectedItems[parent.id] = null;
    } else {
      delete this.selectedItems[parent.id];
    }
    this.updateInput();
    this.updateSelectionInfo();
    this.renderChildren(parent);
  }

  handleItemClick(item) {
    if (!item) return;
    
    // Store current scroll position before navigating
    this.scrollPositions.set('main', this.selectCard.scrollTop);
    
    this.selectedParent = item;
    this.searchInput.value = "";
    this.renderChildren(item);
    this.updateSelectionInfo();
    this.updateHeader(item.name, true);
  }

  handleBackClick() {
    if (this.selectedParent) {
        const previousScrollPosition = this.scrollPositions.get('main');
        // Disable smooth scrolling temporarily
        this.selectCard.style.scrollBehavior = 'auto';
        // Reset to main view
        this.selectedParent = null;
        this.updateHeader(this.options.placeholder, false);
        this.renderItems(this.items);
        // Restore scroll position immediately without animation
        if (previousScrollPosition !== undefined) {
            this.selectCard.scrollTop = previousScrollPosition;
        }
        // Re-enable smooth scrolling after a small delay
        setTimeout(() => {
            this.selectCard.style.scrollBehavior = 'smooth';
        }, 100);
    }
    this.searchInput.value = "";
  }

  showSelectCard() {
    this.selectCard.style.display = "block";
    this.updateHeader(this.options.placeholder);
    this.renderItems(this.items);
  }

  hideSelectCard() {
    if (this.selectCard) {
      this.selectCard.style.display = "none";
      this.scrollPositions.clear(); // Clear stored positions
    }
  }

  updateInput() {
    requestAnimationFrame(() => {
      const chipsContainer = this.getElement('chipsContainer');
      const selectedItemsInput = this.getElement('selectedItemsInput');
      
      chipsContainer.innerHTML = '';
      const selectedItems = this.getSelectedItemsForDisplay();
      
      if (selectedItems.length === 0) {
        this.renderPlaceholder();
      } else {
        this.renderChips(selectedItems);
      }
      
      // Prepare the value object including group IDs if showGroupHeaders is true
      const inputValue = this.options.showGroupHeaders ? 
          this.getSelectedItemsWithGroups() : 
          this.selectedItems;
      
      selectedItemsInput.value = JSON.stringify(inputValue);
    });
  }

  renderChips(chips) {
    const containerWidth = this.chipsContainer.offsetWidth;
    const chipMargin = 4;
    const chipPadding = 8;
    const containerPadding = 12;
    const closeButtonWidth = 16;
    const availableWidth = containerWidth - containerPadding;

    let totalChipsWidth = 0;
    const chipWidths = [];

    chips.forEach((chip) => {
      this.chipsContainer.appendChild(chip);
      const chipWidth = chip.offsetWidth + chipMargin;
      totalChipsWidth += chipWidth;
      chipWidths.push(chipWidth);
      this.chipsContainer.removeChild(chip);
    });

    if (totalChipsWidth > availableWidth) {
      const scaleFactor = availableWidth / totalChipsWidth;
      let currentLineWidth = 0;

      chips.forEach((chip, index) => {
        const newWidth =
          Math.floor(chipWidths[index] * scaleFactor) - chipMargin;
        this.adjustChipWidth(chip, newWidth, closeButtonWidth, chipPadding);
        currentLineWidth += newWidth + chipMargin;

        if (index === chips.length - 1 && currentLineWidth > availableWidth) {
          const finalAdjustment = currentLineWidth - availableWidth;
          this.adjustChipWidth(
            chip,
            newWidth - finalAdjustment,
            closeButtonWidth,
            chipPadding
          );
        }

        this.chipsContainer.appendChild(chip);
      });
    } else {
      chips.forEach((chip) => {
        this.chipsContainer.appendChild(chip);
      });
    }
  }

  adjustChipWidth(chip, width, closeButtonWidth, chipPadding) {
    const minWidth = 30;

    width = Math.max(width, minWidth);

    chip.style.width = `${width}px`;
    chip.style.flex = "0 0 auto";
    const chipText = chip.querySelector(".chip-text");
    chipText.style.width = `${width - closeButtonWidth - chipPadding}px`;
    chipText.style.overflow = "hidden";
    chipText.style.textOverflow = "ellipsis";
  }

  createChip(text, id) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `
      <span class="chip-text" title="${text}">${text}</span>
      <span class="close">&times;</span>
    `;
    chip.querySelector(".close").addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeSelection(id);
    }, { signal: this.signal });
    return chip;
  }

  removeSelection(id) {
    delete this.selectedItems[id];
    this.updateInput();
    this.updateSelectionInfo();
    this.renderItems(this.items);
  }

  updateHeader(title, showBackButton = false) {
    const cardBody = this.selectCard.querySelector('.card-body');
    const existingHeader = cardBody.querySelector('h5.card-title');

    if (existingHeader) {
        existingHeader.remove();
    }

    const header = document.createElement('h5');
    header.className = 'card-title mt-0 d-flex align-items-center';

    if (showBackButton) {
        const backButton = document.createElement('button');
        backButton.type = 'button';
        backButton.className = 'btn-back';
        backButton.innerHTML = `
            <svg class="icon-arrow-left" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        backButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleBackClick();
        }, { signal: this.signal });
        header.appendChild(backButton);
    }

    header.appendChild(document.createTextNode(title));
    cardBody.insertBefore(header, cardBody.firstChild);
  }

  updateSelectionInfo() {
    const selectionInfo = this.selectionInfo;
    const selectedCount = Object.keys(this.selectedItems).length;
    
    if (selectedCount > 0) {
        selectionInfo.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <span>${this.options.selectedText.replace("{n}", selectedCount)}</span>
                <a href="#" class="text-primary text-decoration-none" id="${this.id}-clear-all">
                    ${this.options.clearAllText}
                </a>
            </div>
        `;
        
        const clearAllButton = selectionInfo.querySelector(`#${this.id}-clear-all`);
        clearAllButton.addEventListener("click", (e) => {
            e.preventDefault();
            this.clearAll();
        }, { signal: this.signal });
    } else {
        selectionInfo.innerHTML = this.options.defaultSelectionText;
    }
  }

  clearAll() {
    Object.keys(this.selectedItems).forEach(
      (key) => delete this.selectedItems[key]
    );
    this.renderItems(this.items);
    this.updateInput();
    this.updateSelectionInfo();
  }

  reset() {
    this.selectedItems = {};
    this.updateInput();
    this.updateSelectionInfo();
    this.renderItems(this.items);
    this.hideSelectCard();
  }

  static resetBySelector(formElement, selector) {
    // Only search within the specific form
    const containers = formElement.querySelectorAll(selector);
    containers.forEach(container => {
        const instance = MultipleSelectHierarchy.instances.get(container);
        if (instance) {
            instance.reset();
        }
    });
  }

  static instances = new Map();

  // Only use when remove component
  destroy() {
    this.abortController.abort();
    this.domCache.clear();
    MultipleSelectHierarchy.instances.delete(this.selectElement);
    this.items = null;
    this.selectedItems = null;
    this.options = null;
    this.abortController = null;
  }

  createItemElement(item, selectedParentCount) {
    const li = document.createElement("li");
    li.className = "list-group-item d-flex justify-content-between align-items-center subgroup-item";
    li.dataset.itemId = item.id;
    
    const isChecked = this.selectedItems[item.id] !== undefined;
    const isDisabled = !isChecked && selectedParentCount >= this.options.maxSelections;
    const hasChildren = item.children && item.children.length > 0;

    let selectionText = '';
    if (hasChildren && isChecked) {
        if (this.selectedItems[item.id] === null) {
            selectionText = ` (${this.options.allText})`;
        } else if (Array.isArray(this.selectedItems[item.id])) {
            selectionText = ` (${this.selectedItems[item.id].length} ${this.options.unitChildText})`;
        }
    }

    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'form-check';
    checkboxContainer.innerHTML = `
        <input class="form-check-input" type="checkbox" id="${this.id}-item-${item.id}" 
            ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}>
        <label class="form-check-label" for="${this.id}-item-${item.id}">
            ${item.name}
            <span class="text-black-50">${selectionText}</span>
        </label>
    `;

    li.appendChild(checkboxContainer);

    if (hasChildren) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn btn-link p-0 ${isDisabled ? "disabled" : ""}`;
        button.innerHTML = `
            <svg class="icon-chevron-right ${isDisabled ? "text-muted" : ""}" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        li.appendChild(button);
    }

    return li;
  }

  renderFilteredChildren(searchTerm) {
    if (!this.selectedParent || !this.selectedParent.children) return;

    const fragment = document.createDocumentFragment();
    
    // Always show "All" option
    const allLi = document.createElement('li');
    allLi.className = 'list-group-item';
    allLi.innerHTML = `
        <div class="form-check">
            <input class="form-check-input" type="checkbox" id="${this.id}-allChildren">
            <label class="form-check-label" for="${this.id}-allChildren">${this.options.allText}</label>
        </div>
    `;
    fragment.appendChild(allLi);

    // Filter children
    const filteredChildren = this.selectedParent.children.filter(child =>
        removeDiacritics(child.name.toLowerCase()).includes(searchTerm)
    );

    const allChildrenSelected = this.selectedItems[this.selectedParent.id] === null;

    filteredChildren.forEach(child => {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        const isChecked = allChildrenSelected ||
            (this.selectedItems[this.selectedParent.id] &&
            this.selectedItems[this.selectedParent.id].includes(child.id));

        li.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="${this.id}-child-${child.id}" 
                        ${isChecked ? "checked" : ""}>
                    <label class="form-check-label" for="${this.id}-child-${child.id}">
                        ${child.name}
                    </label>
                </div>
                ${child.children && child.children.length > 0 ? `
                    <button type="button" class="btn btn-link p-0">
                        <svg class="icon-chevron-right" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                ` : ''}
            </div>
        `;

        // Add event listeners
        const checkbox = li.querySelector(`#${this.id}-child-${child.id}`);
        checkbox.addEventListener('change', e =>
            this.handleChildSelection(this.selectedParent, child, e.target.checked),
            { signal: this.signal }
        );

        if (child.children && child.children.length > 0) {
            const button = li.querySelector('.btn-link');
            button.addEventListener('click', e => {
                e.preventDefault();
                this.handleItemClick(child);
            }, { signal: this.signal });
        }

        fragment.appendChild(li);
    });

    this.itemList.innerHTML = '';
    this.itemList.appendChild(fragment);

    // Update "All" checkbox state
    const allChildrenCheckbox = this.itemList.querySelector(`#${this.id}-allChildren`);
    allChildrenCheckbox.checked = allChildrenSelected;
    allChildrenCheckbox.addEventListener('change', e =>
        this.handleAllChildrenSelection(this.selectedParent, e.target.checked),
        { signal: this.signal }
    );
  }

  renderFilteredItems(searchTerm) {
    if (this.selectedParent) {
        // If we're in a subgroup view, search through its children
        this.renderFilteredChildren(searchTerm);
    } else {
        // If we're in the main view, search through groups and subgroups
        const filteredItems = this.items.map(group => {
            // First check if group name matches
            const groupMatches = removeDiacritics(group.name.toLowerCase()).includes(searchTerm);
            
            // Filter children (subgroups)
            const filteredChildren = group.children.filter(subgroup => 
                removeDiacritics(subgroup.name.toLowerCase()).includes(searchTerm)
            );

            // Return group if either group matches or has matching children
            if (groupMatches || filteredChildren.length > 0) {
                return {
                    ...group,
                    children: filteredChildren
                };
            }
            return null;
        }).filter(Boolean); // Remove null items

        this.renderItems(filteredItems);
    }
  }

  getSelectedItemsForDisplay() {
    const selectedItems = [];
    
    // Iterate through all items to find selected subgroups
    this.items.forEach(group => {
        group.children.forEach(subgroup => {
            if (this.selectedItems[subgroup.id] !== undefined) {
                let displayText = subgroup.name;                
                if (this.selectedItems[subgroup.id] === null) {
                    displayText += ``;
                } else if (Array.isArray(this.selectedItems[subgroup.id])) {
                    displayText += ` (${this.selectedItems[subgroup.id].length})`;
                }
                
                selectedItems.push(this.createChip(displayText, subgroup.id));
            }
        });
    });
    
    return selectedItems;
  }

  renderPlaceholder() {
    const placeholderSpan = document.createElement('span');
    placeholderSpan.textContent = this.options.placeholder;
    placeholderSpan.className = 'placeholder-text';
    this.chipsContainer.appendChild(placeholderSpan);
  }

  cacheElements() {
    this.domCache.set('container', this.container);
    this.domCache.set('chipsContainer', this.chipsContainer);
    this.domCache.set('input', this.input);
    this.domCache.set('selectedItemsInput', this.selectedItemsInput);
    this.domCache.set('selectCard', this.selectCard);
    this.domCache.set('searchInput', this.searchInput);
    this.domCache.set('selectionInfo', this.selectionInfo);
    this.domCache.set('itemList', this.itemList);
  }

  getElement(key) {
    if (this.domCache.has(key)) {
      return this.domCache.get(key);
    }
    const element = this.container.querySelector(`#${this.id}-${key}`);
    if (element) {
      this.domCache.set(key, element);
    }
    return element;
  }

  // Simplify the processData method
  processData(items) {
    return items.map(item => ({
        id: item.id, // Ensure group ID is included
        name: item.name,
        children: item.children ? this.processData(item.children) : []
    }));
  }

  // Add this helper method to find items by ID
  findItemById(id, items = this.items) {
    for (const item of items) {
        if (item.id === id) {
            return item;
        }
        if (item.children) {
            const found = this.findItemById(id, item.children);
            if (found) {
                return found;
            }
        }
    }
    return null;
  }

  // Add new method to get selected items with their group IDs
  getSelectedItemsWithGroups() {
    const selectedWithGroups = {};
    
    this.items.forEach(group => {
        const selectedChildrenInGroup = group.children.some(
            subgroup => this.selectedItems[subgroup.id] !== undefined
        );
        
        if (selectedChildrenInGroup) {
            selectedWithGroups[group.id] = {
                children: {}
            };
            
            group.children.forEach(subgroup => {
                if (this.selectedItems[subgroup.id] !== undefined) {
                    selectedWithGroups[group.id].children[subgroup.id] = 
                        this.selectedItems[subgroup.id];
                }
            });
        }
    });
    
    return selectedWithGroups;
  }
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('reset', (event) => {
            MultipleSelectHierarchy.resetBySelector(event.target, '.hierarchy-select-container');
        });
    });
});


window.MultipleSelectHierarchy = MultipleSelectHierarchy;

