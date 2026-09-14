window.NRG_DATA = {
  updatedAt: "01.09.2026",

  tiers: [
    { id: "S", title: "Supreme", note: "запасай ящик", score: 5 },
    { id: "A", title: "Excellent", note: "берём ещё", score: 4 },
    { id: "B", title: "Good", note: "рабочий вариант", score: 3 },
    { id: "C", title: "Situational", note: "по ситуации", score: 2 },
    { id: "D", title: "Regret", note: "энергия ошибки", score: 1 }
  ],

  participants: [
    { id: "sanya", name: "Саня", initials: "СА", role: "участник 01", color: "#ff6b49" },
    { id: "yarik", name: "Ярик", initials: "ЯР", role: "участник 02", color: "#f1c46c" },
    { id: "roma", name: "Рома", initials: "РО", role: "участник 03", color: "#9fb7ff" },
    { id: "person-4", name: "Участник 4", initials: "04", role: "место свободно", color: "#cf8cff" }
  ],

  drinks: [
    {
      id: "adrenaline-yuzu-strawberry-calamansi",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Юдзу · клубника · каламанси",
      edition: "розово-оранжевая банка",
      image: "assets/adrenaline-yuzu-strawberry-calamansi.png",
      sourceLabel: "изображение продукта",
      accent: ["#ff4778", "#ff8a3d"],
      related: [],
      ratings: {
        sanya: {
          tier: "S",
          review: ""
        },
        roma: {
          tier: "B",
          order: 60,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-rush-original",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Оригинальный",
      edition: "классическая чёрно-красная банка",
      image: "assets/adrenaline-rush-original.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#ef252d", "#ffc72c"],
      related: ["adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        sanya: {
          tier: "A",
          order: 130,
          review: "Самый обычный базовый энергетик — ни дать ни взять. Твёрдый B-тир: без изюминки, но просто хороший. Просто как Red Bull."
        },
        roma: {
          tier: "S",
          review: "Самый охуенный NRGOS: очень вкусный, яркий и идеально узнаваемый оригинальный Adrenaline Rush. Никаких сомнительных экспериментов — просто эталонная банка, к которой хочется возвращаться."
        }
      }
    },
    {
      id: "adrenaline-rush-extra",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush Extra",
      flavor: "Усиленная формула",
      edition: "чёрно-красная банка Extra",
      image: "assets/adrenaline-rush-extra.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#d71920", "#f4b323"],
      related: ["adrenaline-rush-original", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "A",
          order: 10,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-rush-breeze",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush Breeze",
      flavor: "Голубая малина · лайм · мята",
      edition: "Ice Effect",
      image: "assets/adrenaline-rush-breeze.webp",
      sourceLabel: "изображение продукта",
      accent: ["#00b8d9", "#7ee6e1"],
      related: ["adrenaline-rush-extra", "adrenaline-rush-original", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "A",
          order: 999,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-melon-lime-mint",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Дыня · лайм · мята",
      edition: "лимитированная коллекция",
      image: "assets/adrenaline-melon-lime-mint.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#6fcf63", "#ffe35c"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "B",
          order: 10,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-zero-sugar",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Silver Energy Zero Sugar",
      edition: "без сахара",
      image: "assets/adrenaline-zero-sugar.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#aab4bd", "#f1f4f5"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "B",
          order: 20,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-tropical-orange",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Tropical Energy · апельсин",
      edition: "оранжевая банка",
      image: "assets/adrenaline-tropical-orange.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#f27a23", "#ffd340"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "B",
          order: 30,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-vitamin-power-berry",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Vitamin Power · ягоды",
      edition: "ягодный Vitamin Power",
      image: "assets/adrenaline-vitamin-power-berry.png",
      sourceLabel: "изображение из присланного скриншота",
      accent: ["#8d297f", "#ed4d96"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "B",
          order: 40,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-guanabana-lime",
      brand: "Adrenaline Rush",
      name: "Adrenaline Summer Edition",
      flavor: "Guanabana · Lime",
      edition: "Summer Edition",
      image: "assets/adrenaline-guanabana-lime.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#3dc46a", "#d9ef45"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "A",
          order: 100,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-pomelo-pineapple",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Помело · ананас",
      edition: "Summer Edition",
      image: "assets/adrenaline-pomelo-pineapple.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#7ac943", "#f6d64a"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-energy-power", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "A",
          order: 110,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-energy-power",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush Energy Power",
      flavor: "Energy Power",
      edition: "синяя банка",
      image: "assets/adrenaline-energy-power.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#2653a5", "#78a7ff"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-mango", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "S",
          order: 20,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-mango",
      brand: "Adrenaline Rush",
      name: "Adrenaline Rush",
      flavor: "Манго",
      edition: "Vitamin Power",
      image: "assets/adrenaline-mango.png",
      sourceLabel: "изображение продукта",
      accent: ["#f4a21f", "#ffd741"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-spicy-energy"],
      ratings: {
        roma: {
          tier: "B",
          order: 70,
          review: ""
        }
      }
    },
    {
      id: "adrenaline-spicy-energy",
      brand: "Adrenaline Rush",
      name: "Adrenaline Spicy Energy",
      flavor: "Гранат · клюква · перец табаско",
      edition: "Hot Effect",
      image: "assets/adrenaline-spicy-energy.webp",
      sourceLabel: "официальное изображение продукта",
      accent: ["#d72525", "#ff8a26"],
      related: ["adrenaline-rush-original", "adrenaline-rush-extra", "adrenaline-rush-breeze", "adrenaline-melon-lime-mint", "adrenaline-zero-sugar", "adrenaline-tropical-orange", "adrenaline-vitamin-power-berry", "adrenaline-guanabana-lime", "adrenaline-pomelo-pineapple", "adrenaline-energy-power", "adrenaline-mango"],
      ratings: {
        roma: {
          tier: "D",
          order: 999,
          review: ""
        }
      }
    },
    {
      id: "burn-tropical-mix",
      brand: "Burn",
      name: "Burn",
      flavor: "Тропический микс",
      edition: "фиолетовая банка",
      image: "assets/burn-tropical-mix.png",
      sourceLabel: "изображение продукта",
      accent: ["#8b3bc4", "#ef3ea6"],
      related: ["burn-juicy-energy", "burn-original", "burn-apple-kiwi"],
      ratings: {
        sanya: {
          tier: "A",
          review: "По запаху и вкусу очень похож на Burn «Сочная энергия», но из этой пары мне больше понравился фиолетовый «Тропический микс»."
        },
        yarik: {
          tier: "C",
          review: "Необычный энергетик, который сначала привлекает нестандартным тропическим вкусом, но в итоге всё равно оказался не очень приятным. На фоне синего Burn «Сочная энергия» выглядит интереснее, однако повторять его особенно не хочется."
        },
        roma: {
          tier: "B",
          order: 100,
          review: ""
        }
      }
    },
    {
      id: "burn-juicy-energy",
      brand: "Burn",
      name: "Burn",
      flavor: "Сочная энергия",
      edition: "синяя банка",
      image: "assets/burn-juicy-energy.png",
      sourceLabel: "изображение продукта",
      accent: ["#008ad8", "#26e2ff"],
      related: ["burn-tropical-mix", "burn-original", "burn-apple-kiwi"],
      ratings: {
        sanya: {
          tier: "A",
          review: "По запаху и основному вкусу очень похож на фиолетовый Burn «Тропический микс», но временами встречается какой-то довольно странный привкус. Поэтому из двух больше понравился фиолетовый."
        },
        yarik: {
          tier: "D",
          review: "Не очень вкусный и в целом непонятный энергетик: вкус не складывается во что-то цельное, а следом остаётся отвратительный привкус. Фиолетовый Burn «Тропический микс» хотя бы необычнее и ощущается интереснее."
        },
        roma: {
          tier: "B",
          order: 80,
          review: ""
        }
      }
    },
    {
      id: "burn-original",
      brand: "Burn",
      name: "Burn",
      flavor: "Оригинальный",
      edition: "классическая чёрная банка",
      image: "assets/burn-original.png",
      sourceLabel: "изображение продукта",
      accent: ["#d9272e", "#ff7a1a"],
      related: ["burn-tropical-mix", "burn-juicy-energy", "burn-apple-kiwi"],
      ratings: {
        roma: {
          tier: "B",
          order: 50,
          review: ""
        }
      }
    },
    {
      id: "burn-apple-kiwi",
      brand: "Burn",
      name: "Burn",
      flavor: "Яблоко · киви",
      edition: "зелёная банка",
      image: "assets/burn-apple-kiwi.png",
      sourceLabel: "изображение продукта",
      accent: ["#39a844", "#b7e43b"],
      related: ["burn-original", "burn-juicy-energy", "burn-tropical-mix"],
      ratings: {
        roma: {
          tier: "B",
          order: 90,
          review: ""
        }
      }
    },
    {
      id: "volt-blueberry-pomegranate",
      brand: "Volt Energy",
      name: "Volt Energy",
      flavor: "Голубика · гранат",
      edition: "ягодный микс",
      image: "assets/volt-blueberry-pomegranate.png",
      sourceLabel: "изображение продукта",
      accent: ["#4726a9", "#ed2e8c"],
      related: ["volt-original", "volt-mango-lime", "volt-plum-pie", "volt-raspberry-lychee"],
      ratings: {
        roma: {
          tier: "A",
          order: 120,
          review: ""
        }
      }
    },
    {
      id: "volt-mango-lime",
      brand: "Volt Energy",
      name: "Volt Energy",
      flavor: "Mango · Lime",
      edition: "манго и лайм",
      image: "assets/volt-mango-lime.png",
      sourceLabel: "изображение продукта",
      accent: ["#ef8e22", "#b9db35"],
      related: ["volt-original", "volt-blueberry-pomegranate", "volt-plum-pie", "volt-raspberry-lychee"],
      ratings: {
        roma: {
          tier: "C",
          order: 10,
          review: ""
        }
      }
    },
    {
      id: "volt-original",
      brand: "Volt Energy",
      name: "Volt Energy",
      flavor: "Оригинальный",
      edition: "классическая банка",
      image: "assets/volt-original.png",
      sourceLabel: "изображение продукта",
      accent: ["#0879e8", "#61e0ff"],
      related: ["volt-blueberry-pomegranate", "volt-mango-lime", "volt-plum-pie", "volt-raspberry-lychee"],
      ratings: {
        roma: {
          tier: "B",
          order: 110,
          review: ""
        }
      }
    },
    {
      id: "lit-strawberry-bubblegum",
      brand: "Lit Energy",
      name: "Lit Energy",
      flavor: "Клубника · Bubble Gum",
      edition: "розовая банка",
      image: "assets/lit-strawberry-bubblegum.png",
      sourceLabel: "изображение продукта",
      accent: ["#ee4389", "#ff9ed2"],
      related: ["lit-citrus-punch"],
      ratings: {
        roma: {
          tier: "S",
          order: 30,
          review: ""
        }
      }
    },
    {
      id: "lit-citrus-punch",
      brand: "Lit Energy",
      name: "Lit Energy",
      flavor: "Цитрусовый удар",
      edition: "чёрно-золотая банка",
      image: "assets/lit-citrus-punch.webp",
      sourceLabel: "изображение продукта",
      accent: ["#b88a1f", "#f6d36b"],
      related: ["lit-strawberry-bubblegum"],
      ratings: {
        yarik: {
          tier: "A",
          order: 10,
          review: "Очень вкусный энергетик —, пожалуй, лучший цитрусовый энергетик из всех, которые я пробовал. Вкус приятный, сладкий, в меру кислый и слегка солоноватый. Послевкусие просто восхитительное. Прекрасный, отличный энергетик, но до полноценного A-топа будто не хватает какой-то маленькой детали. При этом он настолько понравился, что я точно буду покупать его снова."
        }
      }
    },
    {
      id: "volt-plum-pie",
      brand: "Volt Energy",
      name: "Volt Energy",
      flavor: "Сливовый пирог",
      edition: "десертная серия",
      image: "assets/volt-plum-pie.png",
      sourceLabel: "изображение продукта",
      accent: ["#81267f", "#e5579e"],
      related: ["volt-original", "volt-blueberry-pomegranate", "volt-mango-lime", "volt-raspberry-lychee"],
      ratings: {
        roma: {
          tier: "D",
          order: 10,
          review: ""
        }
      }
    },
    {
      id: "volt-raspberry-lychee",
      brand: "Volt Energy",
      name: "Volt Energy",
      flavor: "Малина · личи",
      edition: "ягодный микс",
      image: "assets/volt-raspberry-lychee.png",
      sourceLabel: "изображение продукта",
      accent: ["#e52f74", "#ff9cbf"],
      related: ["volt-original", "volt-blueberry-pomegranate", "volt-mango-lime", "volt-plum-pie"],
      ratings: {
        roma: {
          tier: "C",
          order: 20,
          review: ""
        }
      }
    },
    {
      id: "gorilla-original",
      brand: "Gorilla Energy",
      name: "Gorilla Energy",
      flavor: "Оригинальный",
      edition: "классическая чёрная банка",
      image: "assets/gorilla-original.png",
      sourceLabel: "официальное изображение продукта",
      accent: ["#ee202d", "#f5c12c"],
      related: [],
      ratings: {
        roma: {
          tier: "B",
          order: 120,
          review: ""
        }
      }
    }
  ]
};
