<script>
  import Slider from "./Slider.svelte";
  import { rgbToHex } from "./helpers/color-helpers.js";
  let red = 100;
  let green = 0;
  let blue = 100;
  $: hexColor = rgbToHex(red, green, blue);
</script>

<style>
  .color-display {
    height: 200px;
  }
  .color-controls {
    margin-top: 20px;
  }
  .color-numbers {
    margin-top: 20px;
  }
  .color-numbers > div {
    height: 50px;
    border: solid 1px gray;
    border-radius: 2px;
    text-align: center;
    justify-content: space-around;
    padding: 5px;
  }
</style>

<div bp="grid">
  <div bp="10 offset-2">
    <h1>Color Picker</h1>
  </div>
</div>

<div class="color-controls">
  <Slider bind:color={red} bgColor="#AA0000" />
  <Slider bind:color={green} bgColor="#00AA00" />
  <Slider bind:color={blue} bgColor="#0000AA" />
</div>

<div bp="grid">
  <div
    style="background-color: rgb({red}, {green}, {blue})"
    class="color-display"
    bp="10 offset-2" />
</div>
<div bp="grid" class="color-numbers">
  <div bp="offset-2 5">
    RGB
    <br />
    r={red}, g={green}, b={blue}
  </div>
  <div bp="5">
    HEX
    <br />
    {hexColor}
  </div>

</div>
